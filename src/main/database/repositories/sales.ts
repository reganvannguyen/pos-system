import type {
  PosDatabase,
  ProductRecord,
  SaleItemRecord,
  SaleRecord,
  SettingsRecord
} from '../types'

export interface SaleLineInput {
  productId: number
  quantity: number
}

export interface SaleQuoteLineRecord {
  product_id: number
  sku: string
  product_name: string
  unit_price_cents: number
  quantity: number
  line_total_cents: number
}

export interface SaleQuoteRecord {
  items: SaleQuoteLineRecord[]
  subtotal_cents: number
  tax_cents: number
  total_cents: number
}

export interface SaleSummaryRecord extends SaleRecord {
  item_count: number
}

export interface SaleDetailRecord extends SaleSummaryRecord {
  items: SaleItemRecord[]
}

export type SalesRepositoryErrorCode =
  'invalid-input' | 'unavailable-product' | 'insufficient-stock' | 'not-found'

export class SalesRepositoryError extends Error {
  constructor(
    readonly code: SalesRepositoryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SalesRepositoryError'
  }
}

const saleSummaryColumns = `sales.id, sales.subtotal_cents, sales.tax_cents, sales.total_cents,
  sales.payment_method, sales.created_at,
  (SELECT COUNT(*) FROM sale_items WHERE sale_items.sale_id = sales.id) AS item_count`

export function createSalesRepository(database: PosDatabase) {
  const listRecentStatement = database.prepare(
    `SELECT ${saleSummaryColumns}
     FROM sales
     ORDER BY sales.created_at DESC, sales.id DESC
     LIMIT ?`
  )
  const getSaleStatement = database.prepare(
    `SELECT ${saleSummaryColumns}
     FROM sales
     WHERE sales.id = ?`
  )
  const listItemsStatement = database.prepare(
    `SELECT id, sale_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents
     FROM sale_items
     WHERE sale_id = ?
     ORDER BY id`
  )
  const getProductStatement = database.prepare(
    `SELECT id, sku, name, price_cents, stock_quantity, is_active, created_at, updated_at
     FROM products
     WHERE id = ?`
  )
  const getSettingsStatement = database.prepare(
    `SELECT id, business_name, tax_rate_basis_points, printer_name, auto_print_receipt
     FROM settings
     WHERE id = 1`
  )
  const insertSaleStatement = database.prepare(
    `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
     VALUES (@subtotalCents, @taxCents, @totalCents, @paymentMethod)`
  )
  const insertSaleItemStatement = database.prepare(
    `INSERT INTO sale_items
       (sale_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents)
     VALUES
       (@saleId, @productId, @sku, @productName, @unitPriceCents, @quantity, @lineTotalCents)`
  )
  const decrementStockStatement = database.prepare(
    `UPDATE products
     SET stock_quantity = stock_quantity - @quantity,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @productId
       AND is_active = 1
       AND stock_quantity IS NOT NULL
       AND stock_quantity >= @quantity`
  )

  function getDetail(id: number): SaleDetailRecord | undefined {
    const sale = getSaleStatement.get(id) as SaleSummaryRecord | undefined
    if (!sale) return undefined
    return { ...sale, items: listItemsStatement.all(id) as SaleItemRecord[] }
  }

  function resolveQuote(items: SaleLineInput[]): SaleQuoteRecord {
    const quoteItems: SaleQuoteLineRecord[] = []
    let subtotal = 0n

    for (const item of items) {
      const product = getProductStatement.get(item.productId) as ProductRecord | undefined
      if (!product || product.is_active !== 1) {
        throw new SalesRepositoryError(
          'unavailable-product',
          'A product in this cart is no longer active. Remove it to continue.'
        )
      }

      if (product.stock_quantity !== null && item.quantity > product.stock_quantity) {
        throw insufficientStock(product, item.quantity)
      }

      const lineTotal = toSafeCents(
        BigInt(product.price_cents) * BigInt(item.quantity),
        'The sale amount is too large to process.'
      )
      subtotal += BigInt(lineTotal)
      quoteItems.push({
        product_id: product.id,
        sku: product.sku,
        product_name: product.name,
        unit_price_cents: product.price_cents,
        quantity: item.quantity,
        line_total_cents: lineTotal
      })
    }

    const settings = getSettingsStatement.get() as SettingsRecord | undefined
    if (!settings) throw new Error('The database is missing its default settings row.')

    const subtotalCents = toSafeCents(subtotal, 'The sale subtotal is too large to process.')
    const taxCents = toSafeCents(
      (subtotal * BigInt(settings.tax_rate_basis_points) + 5000n) / 10000n,
      'The sale tax is too large to process.'
    )
    const totalCents = toSafeCents(
      BigInt(subtotalCents) + BigInt(taxCents),
      'The sale total is too large to process.'
    )

    return {
      items: quoteItems,
      subtotal_cents: subtotalCents,
      tax_cents: taxCents,
      total_cents: totalCents
    }
  }

  const completeTransaction = database.transaction(
    (input: { items: SaleLineInput[]; paymentMethod: 'cash' | 'card' }): SaleDetailRecord => {
      const quote = resolveQuote(input.items)
      const saleResult = insertSaleStatement.run({
        subtotalCents: quote.subtotal_cents,
        taxCents: quote.tax_cents,
        totalCents: quote.total_cents,
        paymentMethod: input.paymentMethod
      })
      const saleId = Number(saleResult.lastInsertRowid)

      for (const item of quote.items) {
        const product = getProductStatement.get(item.product_id) as ProductRecord | undefined
        if (!product || product.is_active !== 1) {
          throw new SalesRepositoryError(
            'unavailable-product',
            'A product in this cart is no longer active. Remove it to continue.'
          )
        }

        if (product.stock_quantity !== null) {
          const update = decrementStockStatement.run({
            productId: item.product_id,
            quantity: item.quantity
          })
          if (update.changes !== 1) throw insufficientStock(product, item.quantity)
        }

        insertSaleItemStatement.run({
          saleId,
          productId: item.product_id,
          sku: item.sku,
          productName: item.product_name,
          unitPriceCents: item.unit_price_cents,
          quantity: item.quantity,
          lineTotalCents: item.line_total_cents
        })
      }

      const detail = getDetail(saleId)
      if (!detail) throw new Error('The sale was not available after saving.')
      return detail
    }
  )

  return {
    quote(items: SaleLineInput[]): SaleQuoteRecord {
      if (items.length === 0) throw new SalesRepositoryError('invalid-input', 'The cart is empty.')
      return resolveQuote(items)
    },
    completeCheckout(input: { items: SaleLineInput[]; paymentMethod: 'cash' | 'card' }) {
      if (input.items.length === 0)
        throw new SalesRepositoryError('invalid-input', 'The cart is empty.')
      return completeTransaction.immediate(input)
    },
    listRecent(limit = 100): SaleSummaryRecord[] {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('The sales limit must be a positive integer.')
      }
      return listRecentStatement.all(limit) as SaleSummaryRecord[]
    },
    getById(id: number): SaleDetailRecord | undefined {
      return getDetail(id)
    }
  }
}

export type SalesRepository = ReturnType<typeof createSalesRepository>

function insufficientStock(product: ProductRecord, requested: number): SalesRepositoryError {
  const available = product.stock_quantity ?? 0
  return new SalesRepositoryError(
    'insufficient-stock',
    `Not enough stock for ${product.name}. ${available} available, ${requested} requested.`
  )
}

function toSafeCents(value: bigint, message: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SalesRepositoryError('invalid-input', message)
  }
  return Number(value)
}

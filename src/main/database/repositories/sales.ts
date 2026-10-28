import type { ChargePaymentTenderType, TenderInput, CheckoutItem } from '../../../shared/pos-api'
import type {
  ChargePaymentRecord,
  PosDatabase,
  ProductRecord,
  SaleChargeRecord,
  SaleItemRecord,
  SalePaymentRecord,
  SaleRecord
} from '../types'
import { nextTransactionNumber } from '../transaction-numbers'
import { createTaxRepository } from './taxes'

export type SaleLineInput = CheckoutItem

export interface SaleQuoteLineRecord {
  product_id: number
  sku: string
  product_name: string
  catalog_unit_price_cents: number
  unit_price_cents: number
  price_override_reason: string | null
  quantity: number
  line_total_cents: number
}

export interface SaleQuoteRecord {
  items: SaleQuoteLineRecord[]
  subtotal_cents: number
  tax_breakdown: SaleTaxBreakdownRecord[]
  tax_cents: number
  total_cents: number
}

export interface ReturnLineInput {
  productId: number
  quantity: number
  restock: boolean
}

export interface ReturnQuoteRecord extends SaleQuoteRecord {
  items: Array<SaleQuoteLineRecord & { restock: boolean }>
}

export interface SaleTaxBreakdownRecord {
  tax_name: string
  rate_basis_points: number
  tax_cents: number
}

export interface SaleSummaryRecord extends SaleRecord {
  item_count: number
  customer_first_name: string | null
  customer_last_name: string | null
  customer_company_name: string | null
  payments: SalePaymentRecord[]
  charge: SaleChargeRecord | null
}

type SaleSummaryQueryRecord = SaleRecord &
  Pick<
    SaleSummaryRecord,
    'item_count' | 'customer_first_name' | 'customer_last_name' | 'customer_company_name'
  >

export interface SaleTaxReportRecord {
  sale_id: number
  tax_name: string
  tax_cents: number
}

export interface SaleDetailRecord extends SaleSummaryRecord {
  items: SaleItemRecord[]
  tax_breakdown: SaleTaxBreakdownRecord[]
}

export interface DailyProductSummaryRecord {
  product_id: number | null
  sku: string
  product_name: string
  net_quantity: number
  net_amount_cents: number
}

export interface ProductReportLineRecord {
  sale_id: number
  sale_item_id: number
  product_id: number | null
  sku: string
  product_name: string
  quantity: number
  line_total_cents: number
  transaction_type: 'sale' | 'return'
}

export interface DailyProductByDayRecord extends DailyProductSummaryRecord {
  local_date: string
}

interface ProductLineSummaryRecord {
  product_id: number | null
  sku: string
  product_name: string
  quantity: number
  line_total_cents: number
  transaction_type: 'sale' | 'return'
  created_at: string
}

export interface ChargePaymentSummaryRecord extends ChargePaymentRecord {
  sale_id: number
}

export type SalesRepositoryErrorCode =
  | 'invalid-input'
  | 'unavailable-product'
  | 'insufficient-stock'
  | 'insufficient-payment'
  | 'not-found'

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
  sales.customer_id, sales.payment_method, sales.transaction_type, sales.transaction_number,
  sales.return_reason, sales.created_at,
  customers.first_name AS customer_first_name,
  customers.last_name AS customer_last_name,
  customers.company_name AS customer_company_name,
  (SELECT COUNT(*) FROM sale_items WHERE sale_items.sale_id = sales.id) AS item_count`

export function createSalesRepository(
  database: PosDatabase,
  taxes = createTaxRepository(database)
) {
  const listRecentStatement = database.prepare(
    `SELECT ${saleSummaryColumns}
     FROM sales
     LEFT JOIN customers ON customers.id = sales.customer_id
     ORDER BY sales.created_at DESC, sales.id DESC
     LIMIT ?`
  )
  const listInRangeStatement = database.prepare(
    `SELECT ${saleSummaryColumns}
     FROM sales
     LEFT JOIN customers ON customers.id = sales.customer_id
     WHERE sales.created_at >= @startInclusive AND sales.created_at < @endExclusive
     ORDER BY sales.created_at DESC, sales.id DESC`
  )
  const listTaxLinesInRangeStatement = database.prepare(
    `SELECT sales.id AS sale_id, sale_taxes.tax_name, sale_taxes.tax_cents
     FROM sales
     JOIN sale_taxes ON sale_taxes.sale_id = sales.id
     WHERE sales.created_at >= @startInclusive AND sales.created_at < @endExclusive
     ORDER BY sales.id, sale_taxes.id`
  )
  const listProductLinesInRangeStatement = database.prepare(
    `SELECT sales.id AS sale_id, sale_items.id AS sale_item_id,
            sale_items.product_id, sale_items.sku, sale_items.product_name,
            sale_items.quantity, sale_items.line_total_cents, sales.transaction_type,
            sales.created_at
     FROM sales
     JOIN sale_items ON sale_items.sale_id = sales.id
     WHERE sales.created_at >= @startInclusive AND sales.created_at < @endExclusive
     ORDER BY sales.created_at DESC, sales.id DESC, sale_items.id DESC`
  )
  const getSaleStatement = database.prepare(
    `SELECT ${saleSummaryColumns}
     FROM sales
     LEFT JOIN customers ON customers.id = sales.customer_id
     WHERE sales.id = ?`
  )
  const listItemsStatement = database.prepare(
    `SELECT id, sale_id, product_id, sku, product_name, unit_price_cents,
            original_unit_price_cents, price_override_reason, quantity, line_total_cents,
            restock_requested, restocked_quantity
     FROM sale_items
     WHERE sale_id = ?
     ORDER BY id`
  )
  const listSaleTaxesStatement = database.prepare(
    `SELECT tax_name, rate_basis_points, tax_cents
     FROM sale_taxes
     WHERE sale_id = ?
     ORDER BY id`
  )
  const getProductStatement = database.prepare(
    `SELECT id, sku, name, price_cents, stock_quantity, is_active, created_at, updated_at
     FROM products
     WHERE id = ?`
  )
  const getCustomerForChargeStatement = database.prepare(
    `SELECT first_name, last_name, company_name, address, phone_number, email
     FROM customers
     WHERE id = ?`
  )
  const insertSaleStatement = database.prepare(
    `INSERT INTO sales
       (subtotal_cents, tax_cents, total_cents, customer_id, payment_method, transaction_type,
        transaction_number, return_reason, created_at)
     VALUES (@subtotalCents, @taxCents, @totalCents, @customerId, @paymentMethod, @transactionType,
             @transactionNumber, @returnReason, @createdAt)`
  )
  const insertSaleItemStatement = database.prepare(
    `INSERT INTO sale_items
       (sale_id, product_id, sku, product_name, unit_price_cents,
        original_unit_price_cents, price_override_reason, quantity, line_total_cents,
        restock_requested, restocked_quantity)
     VALUES
       (@saleId, @productId, @sku, @productName, @unitPriceCents,
        @originalUnitPriceCents, @priceOverrideReason, @quantity, @lineTotalCents,
        @restockRequested, @restockedQuantity)`
  )
  const insertSaleTaxStatement = database.prepare(
    `INSERT INTO sale_taxes (sale_id, tax_name, rate_basis_points, tax_cents)
     VALUES (@saleId, @taxName, @rateBasisPoints, @taxCents)`
  )
  const insertSalePaymentStatement = database.prepare(
    `INSERT INTO sale_payments
       (sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents)
     VALUES (@saleId, @type, @amountTenderedCents, @amountAppliedCents, @changeCents)`
  )
  const insertSaleChargeStatement = database.prepare(
    `INSERT INTO sale_charges
       (sale_id, customer_name, company_name, address, phone_number, email, amount_cents)
     VALUES (@saleId, @name, @companyName, @address, @phoneNumber, @email, @amountCents)`
  )
  const insertChargePaymentStatement = database.prepare(
    `INSERT INTO charge_payments (charge_id, payment_type, amount_cents, created_at)
     VALUES (@chargeId, @type, @amountCents, @createdAt)`
  )
  const getChargeBySaleIdStatement = database.prepare(
    `SELECT id, sale_id, customer_name, company_name, address, phone_number, email,
            amount_cents, amount_cents - COALESCE((
              SELECT SUM(amount_cents) FROM charge_payments WHERE charge_id = sale_charges.id
            ), 0) AS balance_cents
     FROM sale_charges WHERE sale_id = ?`
  )
  const listChargePaymentsInRangeStatement = database.prepare(
    `SELECT sale_charges.sale_id, charge_payments.id, charge_payments.charge_id,
            charge_payments.payment_type, charge_payments.amount_cents, charge_payments.created_at
     FROM charge_payments
     JOIN sale_charges ON sale_charges.id = charge_payments.charge_id
     WHERE charge_payments.created_at >= @startInclusive
       AND charge_payments.created_at < @endExclusive
     ORDER BY charge_payments.created_at, charge_payments.id`
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
  const restockStatement = database.prepare(
    `UPDATE products
     SET stock_quantity = stock_quantity + @quantity,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @productId AND stock_quantity IS NOT NULL`
  )

  function attachPayments(rows: SaleSummaryQueryRecord[]): SaleSummaryRecord[] {
    if (rows.length === 0) return []
    const paymentsBySaleId = new Map<number, SalePaymentRecord[]>()
    const ids = rows.map((row) => row.id)
    const chunkSize = 500
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize)
      const placeholders = chunk.map(() => '?').join(', ')
      const payments = database
        .prepare(
          `SELECT id, sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents
           FROM sale_payments
           WHERE sale_id IN (${placeholders})
           ORDER BY sale_id, id`
        )
        .all(...chunk) as SalePaymentRecord[]
      for (const payment of payments) {
        const salePayments = paymentsBySaleId.get(payment.sale_id) ?? []
        salePayments.push(payment)
        paymentsBySaleId.set(payment.sale_id, salePayments)
      }
    }
    const withPayments = rows.map((row) => ({
      ...row,
      payments: paymentsBySaleId.get(row.id) ?? []
    }))
    const chargesBySaleId = new Map<number, SaleChargeRecord>()
    const chargeIds: number[] = []
    const chargeRowsById = new Map<number, Omit<SaleChargeRecord, 'payments'>>()
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize)
      const placeholders = chunk.map(() => '?').join(', ')
      const charges = database
        .prepare(
          `SELECT sale_charges.id, sale_charges.sale_id, sale_charges.customer_name,
                  sale_charges.company_name, sale_charges.address, sale_charges.phone_number,
                  sale_charges.email, sale_charges.amount_cents,
                  sale_charges.amount_cents - COALESCE(SUM(charge_payments.amount_cents), 0) AS balance_cents
           FROM sale_charges
           LEFT JOIN charge_payments ON charge_payments.charge_id = sale_charges.id
           WHERE sale_charges.sale_id IN (${placeholders})
           GROUP BY sale_charges.id
           ORDER BY sale_charges.sale_id`
        )
        .all(...chunk) as Array<Omit<SaleChargeRecord, 'payments'>>
      for (const charge of charges) {
        chargeIds.push(charge.id)
        chargeRowsById.set(charge.id, charge)
      }
    }
    const chargePaymentsByChargeId = new Map<number, ChargePaymentRecord[]>()
    for (let start = 0; start < chargeIds.length; start += chunkSize) {
      const chunk = chargeIds.slice(start, start + chunkSize)
      const placeholders = chunk.map(() => '?').join(', ')
      const chargePayments = database
        .prepare(
          `SELECT id, charge_id, payment_type, amount_cents, created_at
           FROM charge_payments WHERE charge_id IN (${placeholders})
           ORDER BY charge_id, id`
        )
        .all(...chunk) as ChargePaymentRecord[]
      for (const payment of chargePayments) {
        const payments = chargePaymentsByChargeId.get(payment.charge_id) ?? []
        payments.push(payment)
        chargePaymentsByChargeId.set(payment.charge_id, payments)
      }
    }
    for (const charge of chargeRowsById.values()) {
      chargesBySaleId.set(charge.sale_id, {
        ...charge,
        payments: chargePaymentsByChargeId.get(charge.id) ?? []
      })
    }
    return withPayments.map((row) => ({
      ...row,
      charge: chargesBySaleId.get(row.id) ?? null
    }))
  }

  function getDetail(id: number): SaleDetailRecord | undefined {
    const sale = getSaleStatement.get(id) as SaleSummaryQueryRecord | undefined
    if (!sale) return undefined
    const summary = attachPayments([sale])[0]
    if (!summary) return undefined
    return {
      ...summary,
      items: listItemsStatement.all(id) as SaleItemRecord[],
      tax_breakdown: listSaleTaxesStatement.all(id) as SaleTaxBreakdownRecord[]
    }
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

      const unitPriceCents = item.priceOverride?.unitPriceCents ?? product.price_cents
      const priceOverrideReason = item.priceOverride?.reason.trim() || null
      const lineTotal = toSafeCents(
        BigInt(unitPriceCents) * BigInt(item.quantity),
        'The sale amount is too large to process.'
      )
      subtotal += BigInt(lineTotal)
      quoteItems.push({
        product_id: product.id,
        sku: product.sku,
        product_name: product.name,
        catalog_unit_price_cents: product.price_cents,
        unit_price_cents: unitPriceCents,
        price_override_reason: priceOverrideReason,
        quantity: item.quantity,
        line_total_cents: lineTotal
      })
    }

    return calculateQuote(quoteItems, subtotal, 'The sale')
  }

  function resolveReturnQuote(items: ReturnLineInput[]): ReturnQuoteRecord {
    const quoteItems: Array<SaleQuoteLineRecord & { restock: boolean }> = []
    let subtotal = 0n

    for (const item of items) {
      const product = getProductStatement.get(item.productId) as ProductRecord | undefined
      if (!product) {
        throw new SalesRepositoryError(
          'unavailable-product',
          'A product in this return could not be found.'
        )
      }
      const lineTotal = toSafeCents(
        BigInt(product.price_cents) * BigInt(item.quantity),
        'The return amount is too large to process.'
      )
      subtotal += BigInt(lineTotal)
      quoteItems.push({
        product_id: product.id,
        sku: product.sku,
        product_name: product.name,
        catalog_unit_price_cents: product.price_cents,
        unit_price_cents: product.price_cents,
        price_override_reason: null,
        quantity: item.quantity,
        line_total_cents: lineTotal,
        restock: item.restock
      })
    }

    return calculateQuote(quoteItems, subtotal, 'The return')
  }

  function calculateQuote<T extends SaleQuoteLineRecord>(
    quoteItems: T[],
    subtotal: bigint,
    label: 'The sale' | 'The return'
  ): SaleQuoteRecord & { items: T[] } {
    const subtotalCents = toSafeCents(subtotal, `${label} subtotal is too large to process.`)
    let taxTotal = 0n
    const taxBreakdown = taxes.list().map((tax) => {
      const taxCents = toSafeCents(
        (subtotal * BigInt(tax.rate_basis_points) + 5000n) / 10000n,
        `${label} tax is too large to process.`
      )
      taxTotal += BigInt(taxCents)
      return {
        tax_name: tax.name,
        rate_basis_points: tax.rate_basis_points,
        tax_cents: taxCents
      }
    })
    const taxCents = toSafeCents(taxTotal, `${label} tax is too large to process.`)
    const totalCents = toSafeCents(
      BigInt(subtotalCents) + BigInt(taxCents),
      `${label} total is too large to process.`
    )

    return {
      items: quoteItems,
      subtotal_cents: subtotalCents,
      tax_breakdown: taxBreakdown,
      tax_cents: taxCents,
      total_cents: totalCents
    }
  }

  const completeTransaction = database.transaction(
    (input: {
      items: SaleLineInput[]
      tenders: TenderInput[]
      customerId?: number
      chargeRemainingBalance?: boolean
    }): SaleDetailRecord => {
      const quote = resolveQuote(input.items)
      const customer =
        input.customerId === undefined
          ? undefined
          : (getCustomerForChargeStatement.get(input.customerId) as
              | {
                  first_name: string
                  last_name: string
                  company_name: string
                  address: string
                  phone_number: string
                  email: string
                }
              | undefined)
      if (input.customerId !== undefined && !customer) {
        throw new SalesRepositoryError('not-found', 'The selected customer could not be found.')
      }
      if (input.chargeRemainingBalance && !customer) {
        throw new SalesRepositoryError(
          'invalid-input',
          'Select a customer before charging the remaining balance.'
        )
      }
      const allocations = allocatePayments(
        quote.total_cents,
        input.tenders,
        input.chargeRemainingBalance === true
      )
      const amountPaidCents = allocations.reduce(
        (total, payment) => total + payment.amountAppliedCents,
        0
      )
      const chargeAmountCents = quote.total_cents - amountPaidCents
      if (input.chargeRemainingBalance && chargeAmountCents <= 0) {
        throw new SalesRepositoryError(
          'invalid-input',
          'A charge must cover a remaining balance above $0.00.'
        )
      }
      const paymentMethod =
        input.tenders.length === 0 || input.tenders.every((tender) => tender.type === 'cash')
          ? 'cash'
          : 'card'
      const now = new Date()
      const saleResult = insertSaleStatement.run({
        subtotalCents: quote.subtotal_cents,
        taxCents: quote.tax_cents,
        totalCents: quote.total_cents,
        customerId: input.customerId ?? null,
        paymentMethod,
        transactionType: 'sale',
        transactionNumber: nextTransactionNumber(database, now),
        returnReason: null,
        createdAt: now.toISOString().slice(0, 19).replace('T', ' ')
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
          originalUnitPriceCents: item.catalog_unit_price_cents,
          priceOverrideReason: item.price_override_reason,
          quantity: item.quantity,
          lineTotalCents: item.line_total_cents,
          restockRequested: 0,
          restockedQuantity: 0
        })
      }

      for (const tax of quote.tax_breakdown) {
        insertSaleTaxStatement.run({
          saleId,
          taxName: tax.tax_name,
          rateBasisPoints: tax.rate_basis_points,
          taxCents: tax.tax_cents
        })
      }

      for (const payment of allocations) {
        insertSalePaymentStatement.run({
          saleId,
          type: payment.type,
          amountTenderedCents: payment.amountTenderedCents,
          amountAppliedCents: payment.amountAppliedCents,
          changeCents: payment.changeCents
        })
      }

      if (input.chargeRemainingBalance && customer) {
        const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ')
        insertSaleChargeStatement.run({
          saleId,
          name: name || customer.company_name,
          companyName: customer.company_name,
          address: customer.address,
          phoneNumber: customer.phone_number,
          email: customer.email,
          amountCents: chargeAmountCents
        })
      }

      const detail = getDetail(saleId)
      if (!detail) throw new Error('The sale was not available after saving.')
      return detail
    }
  )

  const completeReturnTransaction = database.transaction(
    (input: {
      items: ReturnLineInput[]
      reason: string
      tenders: TenderInput[]
      customerId?: number
    }): SaleDetailRecord => {
      const quote = resolveReturnQuote(input.items)
      const allocations = allocateReturnPayments(quote.total_cents, input.tenders)
      if (input.customerId !== undefined && !getCustomerForChargeStatement.get(input.customerId)) {
        throw new SalesRepositoryError('not-found', 'The selected customer could not be found.')
      }
      const paymentMethod =
        input.tenders.length === 0 || input.tenders.every((tender) => tender.type === 'cash')
          ? 'cash'
          : 'card'
      const now = new Date()
      const saleResult = insertSaleStatement.run({
        subtotalCents: quote.subtotal_cents,
        taxCents: quote.tax_cents,
        totalCents: quote.total_cents,
        customerId: input.customerId ?? null,
        paymentMethod,
        transactionType: 'return',
        transactionNumber: nextTransactionNumber(database, now),
        returnReason: input.reason,
        createdAt: now.toISOString().slice(0, 19).replace('T', ' ')
      })
      const saleId = Number(saleResult.lastInsertRowid)

      for (const item of quote.items) {
        const product = getProductStatement.get(item.product_id) as ProductRecord | undefined
        if (!product) {
          throw new SalesRepositoryError(
            'unavailable-product',
            'A product in this return could not be found.'
          )
        }
        let restockedQuantity = 0
        if (item.restock && product.stock_quantity !== null) {
          if (
            !Number.isSafeInteger(product.stock_quantity) ||
            product.stock_quantity + item.quantity > Number.MAX_SAFE_INTEGER
          ) {
            throw new SalesRepositoryError(
              'invalid-input',
              'The product stock amount is too large.'
            )
          }
          const update = restockStatement.run({
            productId: item.product_id,
            quantity: item.quantity
          })
          if (update.changes !== 1) {
            throw new SalesRepositoryError('invalid-input', 'Product stock could not be updated.')
          }
          restockedQuantity = item.quantity
        }

        insertSaleItemStatement.run({
          saleId,
          productId: item.product_id,
          sku: item.sku,
          productName: item.product_name,
          unitPriceCents: item.unit_price_cents,
          originalUnitPriceCents: item.catalog_unit_price_cents,
          priceOverrideReason: null,
          quantity: item.quantity,
          lineTotalCents: item.line_total_cents,
          restockRequested: Number(item.restock),
          restockedQuantity
        })
      }

      for (const tax of quote.tax_breakdown) {
        insertSaleTaxStatement.run({
          saleId,
          taxName: tax.tax_name,
          rateBasisPoints: tax.rate_basis_points,
          taxCents: tax.tax_cents
        })
      }

      for (const payment of allocations) {
        insertSalePaymentStatement.run({
          saleId,
          type: payment.type,
          amountTenderedCents: payment.amountCents,
          amountAppliedCents: payment.amountCents,
          changeCents: 0
        })
      }

      const detail = getDetail(saleId)
      if (!detail) throw new Error('The return was not available after saving.')
      return detail
    }
  )

  const recordChargePayment = database.transaction(
    (input: { saleId: number; type: ChargePaymentTenderType; amountCents: number }) => {
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        throw new SalesRepositoryError('invalid-input', 'Payment amounts must be above zero.')
      }
      const charge = getChargeBySaleIdStatement.get(input.saleId) as
        Omit<SaleChargeRecord, 'payments'> | undefined
      if (!charge) {
        const sale = getSaleStatement.get(input.saleId) as SaleRecord | undefined
        if (!sale) {
          throw new SalesRepositoryError('not-found', 'This transaction could not be found.')
        }
        throw new SalesRepositoryError(
          'invalid-input',
          'This sale does not have an outstanding charge.'
        )
      }
      if (input.amountCents > charge.balance_cents) {
        throw new SalesRepositoryError(
          'invalid-input',
          'The payment cannot be greater than the outstanding charge balance.'
        )
      }
      insertChargePaymentStatement.run({
        chargeId: charge.id,
        type: input.type,
        amountCents: input.amountCents,
        createdAt: new Date().toISOString().slice(0, 19).replace('T', ' ')
      })
      const detail = getDetail(input.saleId)
      if (!detail) throw new Error('The transaction was not available after recording payment.')
      return detail
    }
  )

  return {
    quote(items: SaleLineInput[]): SaleQuoteRecord {
      if (items.length === 0) throw new SalesRepositoryError('invalid-input', 'The cart is empty.')
      return resolveQuote(items)
    },
    quoteReturn(items: ReturnLineInput[]): ReturnQuoteRecord {
      if (items.length === 0)
        throw new SalesRepositoryError('invalid-input', 'Add at least one product to the return.')
      return resolveReturnQuote(items)
    },
    completeCheckout(input: {
      items: SaleLineInput[]
      tenders: TenderInput[]
      customerId?: number
      chargeRemainingBalance?: boolean
    }) {
      if (input.items.length === 0)
        throw new SalesRepositoryError('invalid-input', 'The cart is empty.')
      return completeTransaction.immediate(input)
    },
    recordChargePayment(input: {
      saleId: number
      type: ChargePaymentTenderType
      amountCents: number
    }) {
      return recordChargePayment.immediate(input)
    },
    completeReturn(input: {
      items: ReturnLineInput[]
      reason: string
      tenders: TenderInput[]
      customerId?: number
    }) {
      if (input.items.length === 0)
        throw new SalesRepositoryError('invalid-input', 'Add at least one product to the return.')
      return completeReturnTransaction.immediate(input)
    },
    listRecent(limit = 100): SaleSummaryRecord[] {
      if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('The sales limit must be a positive integer.')
      }
      const rows = listRecentStatement.all(limit) as SaleSummaryQueryRecord[]
      return attachPayments(rows)
    },
    listInRange(startInclusive: string, endExclusive: string): SaleSummaryRecord[] {
      const rows = listInRangeStatement.all({
        startInclusive,
        endExclusive
      }) as SaleSummaryQueryRecord[]
      return attachPayments(rows)
    },
    taxLinesInRange(startInclusive: string, endExclusive: string): SaleTaxReportRecord[] {
      return listTaxLinesInRangeStatement.all({
        startInclusive,
        endExclusive
      }) as SaleTaxReportRecord[]
    },
    chargePaymentsInRange(
      startInclusive: string,
      endExclusive: string
    ): ChargePaymentSummaryRecord[] {
      return listChargePaymentsInRangeStatement.all({
        startInclusive,
        endExclusive
      }) as ChargePaymentSummaryRecord[]
    },
    productLinesInRange(startInclusive: string, endExclusive: string): ProductReportLineRecord[] {
      return listProductLinesInRangeStatement.all({
        startInclusive,
        endExclusive
      }) as ProductReportLineRecord[]
    },
    productTotalsInRange(
      startInclusive: string,
      endExclusive: string
    ): DailyProductSummaryRecord[] {
      return aggregateProductLines(
        listProductLinesInRangeStatement.all({
          startInclusive,
          endExclusive
        }) as ProductLineSummaryRecord[],
        false
      )
    },
    productTotalsByLocalDayInRange(
      startInclusive: string,
      endExclusive: string
    ): DailyProductByDayRecord[] {
      return aggregateProductLines(
        listProductLinesInRangeStatement.all({
          startInclusive,
          endExclusive
        }) as ProductLineSummaryRecord[],
        true
      )
    },
    getById(id: number): SaleDetailRecord | undefined {
      return getDetail(id)
    }
  }
}

export type SalesRepository = ReturnType<typeof createSalesRepository>

function aggregateProductLines(
  lines: ProductLineSummaryRecord[],
  groupByLocalDay: false
): DailyProductSummaryRecord[]
function aggregateProductLines(
  lines: ProductLineSummaryRecord[],
  groupByLocalDay: true
): DailyProductByDayRecord[]
function aggregateProductLines(
  lines: ProductLineSummaryRecord[],
  groupByLocalDay: boolean
): Array<DailyProductSummaryRecord | DailyProductByDayRecord> {
  const totals = new Map<
    string,
    {
      local_date: string
      product_id: number | null
      sku: string
      product_name: string
      net_quantity: bigint
      net_amount_cents: bigint
    }
  >()

  for (const line of lines) {
    const localDate = groupByLocalDay ? localDateKey(line.created_at) : ''
    const productKey =
      line.product_id === null
        ? `snapshot:${JSON.stringify([line.sku, line.product_name])}`
        : `product:${line.product_id}`
    const key = `${localDate}\u0000${productKey}`
    let total = totals.get(key)
    if (!total) {
      total = {
        local_date: localDate,
        product_id: line.product_id,
        sku: line.sku,
        product_name: line.product_name,
        net_quantity: 0n,
        net_amount_cents: 0n
      }
      totals.set(key, total)
    }

    const sign = line.transaction_type === 'return' ? -1n : 1n
    total.net_quantity += sign * BigInt(line.quantity)
    total.net_amount_cents += sign * BigInt(line.line_total_cents)
  }

  const records = [...totals.values()].map((total) => ({
    local_date: total.local_date,
    product_id: total.product_id,
    sku: total.sku,
    product_name: total.product_name,
    net_quantity: toSafeSignedInteger(total.net_quantity),
    net_amount_cents: toSafeSignedInteger(total.net_amount_cents)
  }))

  const sortedRecords = records.sort((left, right) => {
    const dayOrder = groupByLocalDay ? right.local_date.localeCompare(left.local_date) : 0
    return (
      dayOrder ||
      left.product_name.localeCompare(right.product_name) ||
      left.sku.localeCompare(right.sku)
    )
  })

  if (groupByLocalDay) return sortedRecords as DailyProductByDayRecord[]
  return sortedRecords.map((record) => ({
    product_id: record.product_id,
    sku: record.sku,
    product_name: record.product_name,
    net_quantity: record.net_quantity,
    net_amount_cents: record.net_amount_cents
  }))
}

function localDateKey(createdAt: string): string {
  const date = new Date(`${createdAt.replace(' ', 'T')}Z`)
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function allocatePayments(
  totalCents: number,
  tenders: TenderInput[],
  allowRemaining = false
): Array<{
  type: TenderInput['type']
  amountTenderedCents: number
  amountAppliedCents: number
  changeCents: number
}> {
  let remaining = totalCents
  const allocations: Array<{
    type: TenderInput['type']
    amountTenderedCents: number
    amountAppliedCents: number
    changeCents: number
  }> = []

  for (const tender of tenders) {
    if (!Number.isSafeInteger(tender.amountCents) || tender.amountCents <= 0) {
      throw new SalesRepositoryError('invalid-input', 'Payment amounts must be above zero.')
    }
    if (remaining <= 0) {
      throw new SalesRepositoryError('invalid-input', 'The sale is already fully paid.')
    }
    if (tender.type !== 'cash' && tender.amountCents > remaining) {
      throw new SalesRepositoryError(
        'invalid-input',
        'A card payment cannot be greater than the remaining balance.'
      )
    }

    const amountAppliedCents = Math.min(tender.amountCents, remaining)
    const changeCents = tender.type === 'cash' ? tender.amountCents - amountAppliedCents : 0
    allocations.push({
      type: tender.type,
      amountTenderedCents: tender.amountCents,
      amountAppliedCents,
      changeCents
    })
    remaining -= amountAppliedCents
  }

  if (remaining > 0 && !allowRemaining) {
    throw new SalesRepositoryError(
      'insufficient-payment',
      'Payments do not cover the sale total. Add another payment to continue.'
    )
  }
  return allocations
}

function allocateReturnPayments(
  totalCents: number,
  tenders: TenderInput[]
): Array<{ type: TenderInput['type']; amountCents: number }> {
  let payoutCents = 0n
  for (const tender of tenders) {
    if (!Number.isSafeInteger(tender.amountCents) || tender.amountCents <= 0) {
      throw new SalesRepositoryError('invalid-input', 'Refund amounts must be above zero.')
    }
    payoutCents += BigInt(tender.amountCents)
    if (payoutCents > BigInt(totalCents)) {
      throw new SalesRepositoryError(
        'invalid-input',
        'Refund payouts cannot be greater than the return total.'
      )
    }
  }

  if (payoutCents < BigInt(totalCents)) {
    throw new SalesRepositoryError(
      'insufficient-payment',
      'Refund payouts must cover the return total exactly.'
    )
  }
  if (totalCents === 0 && tenders.length > 0) {
    throw new SalesRepositoryError('invalid-input', 'A zero-total return does not need a payout.')
  }
  return tenders.map((tender) => ({ type: tender.type, amountCents: tender.amountCents }))
}

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

function toSafeSignedInteger(value: bigint): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) {
    throw new Error('The daily product total is too large to display.')
  }
  return number
}

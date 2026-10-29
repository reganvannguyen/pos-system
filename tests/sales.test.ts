import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createProductRepository } from '../src/main/database/repositories/products'
import { createSalesRepository } from '../src/main/database/repositories/sales'
import { createSettingsRepository } from '../src/main/database/repositories/settings'
import { createTaxRepository } from '../src/main/database/repositories/taxes'
import { backfillTransactionNumbers } from '../src/main/database/transaction-numbers'
import { createSalesExportService, serializeSalesCsv } from '../src/main/sales-export-service'
import { resolveSalesPeriod } from '../src/main/sales-period'
import { createSalesService, toSalesResult, toSalesResultAsync } from '../src/main/sales-service'

const schemaBeforeReturns =
  readFileSync(join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/002_multiple_tax_rates.sql'),
    'utf8'
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/003_tenders_and_price_overrides.sql'),
    'utf8'
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/004_credit_tender_type.sql'),
    'utf8'
  ) +
  readFileSync(join(process.cwd(), 'src/main/database/migrations/005_business_email.sql'), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/006_receipt_business_details.sql'),
    'utf8'
  )
const schemaBeforeChargePaymentTenders =
  schemaBeforeReturns +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/007_standalone_returns.sql'),
    'utf8'
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/008_transaction_numbers.sql'),
    'utf8'
  ) +
  readFileSync(join(process.cwd(), 'src/main/database/migrations/009_sale_charges.sql'), 'utf8')
const schema =
  schemaBeforeChargePaymentTenders +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/010_charge_payment_tenders.sql'),
    'utf8'
  ) +
  readFileSync(join(process.cwd(), 'src/main/database/migrations/011_customers.sql'), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/012_transaction_customers.sql'),
    'utf8'
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/013_receipt_font_weight.sql'),
    'utf8'
  )

interface SalesTestContext {
  database: Database.Database
  products: ReturnType<typeof createProductRepository>
  settings: ReturnType<typeof createSettingsRepository>
  taxes: ReturnType<typeof createTaxRepository>
  service: ReturnType<typeof createSalesService>
}

function withSales<T>(run: (context: SalesTestContext) => T): T {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const settings = createSettingsRepository(database)
  const taxes = createTaxRepository(database)
  const service = createSalesService(createSalesRepository(database, taxes))

  const close = (): void => {
    database.close()
  }

  try {
    const result = run({ database, products, settings, taxes, service })
    if (result instanceof Promise) return result.finally(close) as T
    close()
    return result
  } catch (error) {
    close()
    throw error
  }
}

function createProduct(
  products: ReturnType<typeof createProductRepository>,
  values: { sku: string; name: string; priceCents: number; stockQuantity?: number | null }
): number {
  const product = products.create({
    sku: values.sku,
    name: values.name,
    priceCents: values.priceCents,
    stockQuantity: values.stockQuantity ?? null
  })
  assert.ok(product)
  return product.id
}

function localTimestamp(year: number, month: number, day: number, hour = 12, minute = 0): string {
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(hour, minute, 0, 0)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function setSaleTimestamp(database: Database.Database, saleId: number, timestamp: string): void {
  database.prepare('UPDATE sales SET created_at = ? WHERE id = ?').run(timestamp, saleId)
}

function createCustomer(
  database: Database.Database,
  values: Partial<{
    firstName: string
    lastName: string
    companyName: string
    address: string
    phoneNumber: string
    email: string
  }> = {}
): number {
  const result = database
    .prepare(
      `INSERT INTO customers
         (first_name, last_name, company_name, address, phone_number, email)
       VALUES (@firstName, @lastName, @companyName, @address, @phoneNumber, @email)`
    )
    .run({
      firstName: values.firstName ?? '',
      lastName: values.lastName ?? '',
      companyName: values.companyName ?? '',
      address: values.address ?? '',
      phoneNumber: values.phoneNumber ?? '',
      email: values.email ?? ''
    })
  return Number(result.lastInsertRowid)
}

function completeWithPayment(
  service: ReturnType<typeof createSalesService>,
  items: Array<{
    productId: number
    quantity: number
    priceOverride?: { unitPriceCents: number; reason: string }
  }>,
  method: 'cash' | 'card' = 'cash'
) {
  const totalCents = service.quote(items).totalCents
  return service.completeCheckout({
    items,
    tenders:
      totalCents === 0
        ? []
        : [{ type: method === 'cash' ? 'cash' : 'credit', amountCents: totalCents }]
  })
}

function assertSaleError<T>(
  result: ReturnType<typeof toSalesResult<T>>,
  code: string
): asserts result is { ok: false; error: { code: string; message: string } } {
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, code)
}

test('forward return migration keeps existing records as sales and defaults restock fields off', () => {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schemaBeforeReturns)
  const productId = Number(
    database
      .prepare('INSERT INTO products (sku, name, price_cents) VALUES (?, ?, ?)')
      .run('OLD-SALE', 'Old sale item', 500).lastInsertRowid
  )
  const saleId = Number(
    database
      .prepare(
        `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
         VALUES (500, 0, 500, 'cash')`
      )
      .run().lastInsertRowid
  )
  database
    .prepare(
      `INSERT INTO sale_items (sale_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents)
       VALUES (?, ?, 'OLD-SALE', 'Old sale item', 500, 1, 500)`
    )
    .run(saleId, productId)

  database.exec(
    readFileSync(
      join(process.cwd(), 'src/main/database/migrations/007_standalone_returns.sql'),
      'utf8'
    )
  )
  const migratedSale = database
    .prepare('SELECT transaction_type, return_reason FROM sales WHERE id = ?')
    .get(saleId) as { transaction_type: string; return_reason: string | null }
  const migratedItem = database
    .prepare('SELECT restock_requested, restocked_quantity FROM sale_items WHERE sale_id = ?')
    .get(saleId) as { restock_requested: number; restocked_quantity: number }

  assert.deepEqual(migratedSale, { transaction_type: 'sale', return_reason: null })
  assert.deepEqual(migratedItem, { restock_requested: 0, restocked_quantity: 0 })
  database.close()
})

test('return quotes use current catalog prices and tax, accept inactive products, and sign amounts negative', () => {
  withSales(({ products, taxes, service }) => {
    const productId = createProduct(products, {
      sku: 'RETURN-QUOTE',
      name: 'Return item',
      priceCents: 1000,
      stockQuantity: 2
    })
    products.setActive(productId, false)
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])

    const quote = service.quoteReturn({
      reason: '  Customer changed mind  ',
      items: [{ productId, quantity: 2, restock: false }]
    })

    assert.equal(quote.returnReason, 'Customer changed mind')
    assert.equal(quote.subtotalCents, -2000)
    assert.equal(quote.taxCents, -100)
    assert.equal(quote.totalCents, -2100)
    assert.deepEqual(
      quote.items.map(({ unitPriceCents, quantity, lineTotalCents, restock }) => [
        unitPriceCents,
        quantity,
        lineTotalCents,
        restock
      ]),
      [[-1000, 2, -2000, false]]
    )
    assert.equal(quote.taxBreakdown[0]?.taxCents, -100)
  })
})

test('returns require a reason and reject transaction price overrides', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'RETURN-VALIDATION',
      name: 'Return validation item',
      priceCents: 100
    })
    assertSaleError(
      toSalesResult(() =>
        service.quoteReturn({ reason: '  ', items: [{ productId, quantity: 1, restock: false }] })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.quoteReturn({
          reason: 'Price exception',
          items: [
            {
              productId,
              quantity: 1,
              restock: false,
              priceOverride: { unitPriceCents: 25, reason: 'special' }
            }
          ]
        })
      ),
      'invalid-input'
    )
  })
})

test('allows a zero-total return with an item and reason but without payout', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'ZERO-RETURN',
      name: 'Free return item',
      priceCents: 0,
      stockQuantity: 1
    })
    const result = service.completeReturn({
      reason: 'Free item returned',
      items: [{ productId, quantity: 1, restock: true }],
      tenders: []
    })

    assert.equal(result.return.totalCents, 0)
    assert.deepEqual(result.return.payments, [])
    assert.equal(result.return.items[0]?.restockedQuantity, 1)
    assert.equal(
      (
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId) as {
          stock_quantity: number
        }
      ).stock_quantity,
      2
    )
  })
})

test('links a selected customer to both sales and returns', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CUSTOMER-LINK',
      name: 'Customer-linked item',
      priceCents: 500
    })
    const customerId = createCustomer(database, {
      firstName: 'Casey',
      lastName: 'Shopper',
      companyName: 'Example Studio'
    })
    const sale = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: 500 }],
      customerId
    }).sale
    const returned = service.completeReturn({
      reason: 'Exchange',
      items: [{ productId, quantity: 1, restock: false }],
      tenders: [{ type: 'cash', amountCents: 500 }],
      customerId
    }).return

    assert.deepEqual(sale.customer, {
      id: customerId,
      name: 'Casey Shopper',
      companyName: 'Example Studio'
    })
    assert.deepEqual(returned.customer, sale.customer)
    assert.deepEqual(
      service.listRecent().map(({ customer }) => customer?.id ?? null),
      [customerId, customerId]
    )
  })
})

test('return payouts must match exactly and only selected tracked products are restocked', () => {
  withSales(({ database, products, taxes, service }) => {
    const trackedId = createProduct(products, {
      sku: 'RETURN-TRACKED',
      name: 'Tracked return item',
      priceCents: 500,
      stockQuantity: 2
    })
    const untrackedId = createProduct(products, {
      sku: 'RETURN-UNTRACKED',
      name: 'Untracked return item',
      priceCents: 250,
      stockQuantity: null
    })
    products.setActive(trackedId, false)
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])

    const result = service.completeReturn({
      reason: 'Packaging was damaged',
      items: [
        { productId: trackedId, quantity: 2, restock: true },
        { productId: untrackedId, quantity: 1, restock: true }
      ],
      tenders: [
        { type: 'cash', amountCents: 500 },
        { type: 'credit', amountCents: 813 }
      ]
    })
    const returned = service.getById(result.return.id)

    assert.equal(result.return.transactionType, 'return')
    assert.equal(result.return.returnReason, 'Packaging was damaged')
    assert.equal(result.return.subtotalCents, -1250)
    assert.equal(result.return.taxCents, -63)
    assert.equal(result.return.totalCents, -1313)
    assert.equal(result.return.paymentMethod, 'split')
    assert.deepEqual(
      result.return.payments.map((payment) => [payment.type, payment.amountAppliedCents]),
      [
        ['cash', -500],
        ['credit', -813]
      ]
    )
    assert.deepEqual(
      returned.items.map((item) => [
        item.unitPriceCents,
        item.quantity,
        item.lineTotalCents,
        item.restockRequested,
        item.restockedQuantity
      ]),
      [
        [-500, 2, -1000, true, 2],
        [-250, 1, -250, true, 0]
      ]
    )
    assert.equal(
      (
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(trackedId) as {
          stock_quantity: number
        }
      ).stock_quantity,
      4
    )
    assert.equal(
      (
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(untrackedId) as {
          stock_quantity: number | null
        }
      ).stock_quantity,
      null
    )
    assert.equal(
      (
        database.prepare('SELECT price_cents FROM products WHERE id = ?').get(trackedId) as {
          price_cents: number
        }
      ).price_cents,
      500
    )
  })
})

test('return payout shortage, excess, and failed writes do not leave a return or stock update', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'RETURN-ROLLBACK',
      name: 'Return rollback item',
      priceCents: 1000,
      stockQuantity: 3
    })
    const request = {
      reason: 'Refund requested',
      items: [{ productId, quantity: 1, restock: true }]
    }
    assertSaleError(
      toSalesResult(() =>
        service.completeReturn({ ...request, tenders: [{ type: 'cash', amountCents: 900 }] })
      ),
      'insufficient-payment'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeReturn({ ...request, tenders: [{ type: 'cash', amountCents: 1001 }] })
      ),
      'invalid-input'
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)

    database.exec(`CREATE TRIGGER fail_return_payment BEFORE INSERT ON sale_payments
      BEGIN SELECT RAISE(ABORT, 'forced refund payout write failure'); END;`)
    assert.throws(
      () =>
        service.completeReturn({
          ...request,
          tenders: [{ type: 'cash', amountCents: 1000 }]
        }),
      /forced refund payout write failure/
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)
    assert.equal(
      (
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId) as {
          stock_quantity: number
        }
      ).stock_quantity,
      3
    )
  })
})

test('sales reports and CSV show negative returns, reasons, and received/refunded/net tenders', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'RETURN-REPORT',
      name: 'Return report item',
      priceCents: 1000,
      stockQuantity: 4
    })
    const completedSale = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: 1000 }]
    })
    const returned = service.completeReturn({
      reason: 'Customer changed mind, unopened',
      items: [{ productId, quantity: 1, restock: false }],
      tenders: [{ type: 'credit', amountCents: 1000 }]
    })
    setSaleTimestamp(database, completedSale.sale.id, localTimestamp(2025, 4, 8))
    setSaleTimestamp(database, returned.return.id, localTimestamp(2025, 4, 8, 13))

    const report = service.report({ type: 'day', date: '2025-04-08' })
    assert.equal(report.totals.transactionCount, 2)
    assert.equal(report.totals.saleCount, 1)
    assert.equal(report.totals.returnCount, 1)
    assert.equal(report.totals.grossSalesTotalCents, 1000)
    assert.equal(report.totals.returnsTotalCents, -1000)
    assert.equal(report.totals.netTotalCents, 0)
    assert.equal(report.totals.cashReceivedCents, 1000)
    assert.equal(report.totals.cardRefundedCents, 1000)
    assert.equal(report.totals.cardNetCents, -1000)
    assert.equal(report.sales[0]?.transactionType, 'return')
    assert.equal(report.sales[0]?.totalCents, -1000)
    const csv = serializeSalesCsv(report.sales)
    assert.equal(
      csv.split('\r\n')[1],
      `return,Return #${returned.return.transactionNumber},2025-04-08 13:00:00,card,Credit: refunded -10.00,"Customer changed mind, unopened",1,-10.00,0.00,-10.00`
    )
  })
})

test('quotes current prices and rounds tax once across the sale subtotal', () => {
  withSales(({ products, taxes, service }) => {
    const twoCentProductId = createProduct(products, {
      sku: 'TWO-CENTS',
      name: 'Two cents',
      priceCents: 2
    })
    const threeCentProductId = createProduct(products, {
      sku: 'THREE-CENTS',
      name: 'Three cents',
      priceCents: 3
    })
    taxes.save([{ name: 'GST', rateBasisPoints: 1000 }])

    const quote = service.quote([
      { productId: twoCentProductId, quantity: 1 },
      { productId: threeCentProductId, quantity: 1 }
    ])

    assert.equal(quote.subtotalCents, 5)
    assert.equal(quote.taxCents, 1)
    assert.equal(quote.totalCents, 6)
    assert.deepEqual(
      quote.items.map(({ unitPriceCents, lineTotalCents }) => [unitPriceCents, lineTotalCents]),
      [
        [2, 2],
        [3, 3]
      ]
    )
  })
})

test('checkout resolves current price and stores historical line snapshots', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'COFFEE',
      name: 'Coffee',
      priceCents: 100,
      stockQuantity: 5
    })

    products.update(productId, {
      sku: 'COFFEE',
      name: 'Large coffee',
      priceCents: 125,
      stockQuantity: 5
    })

    const sale = completeWithPayment(service, [{ productId, quantity: 2 }])
    products.update(productId, {
      sku: 'COFFEE-LARGE',
      name: 'Renamed coffee',
      priceCents: 250,
      stockQuantity: 3
    })
    const historicalSale = service.getById(sale.sale.id)

    assert.equal(sale.sale.subtotalCents, 250)
    assert.equal(sale.sale.items[0]?.sku, 'COFFEE')
    assert.equal(sale.sale.items[0]?.name, 'Large coffee')
    assert.equal(sale.sale.items[0]?.unitPriceCents, 125)
    assert.equal(sale.sale.items[0]?.lineTotalCents, 250)
    assert.deepEqual(historicalSale.items, sale.sale.items)
  })
})

test('custom sale items use configured taxes and save snapshots without catalog products', () => {
  withSales(({ database, taxes, service }) => {
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])
    const items = [
      {
        customItem: { name: '  Photo Studio Shoot  ', unitPriceCents: 2000 },
        quantity: 2,
        priceOverride: { unitPriceCents: 1800, reason: 'Package rate' }
      }
    ]
    const quote = service.quote(items)

    assert.deepEqual(quote.items[0], {
      productId: null,
      sku: '',
      name: 'Photo Studio Shoot',
      catalogUnitPriceCents: 2000,
      unitPriceCents: 1800,
      priceOverrideReason: 'Package rate',
      quantity: 2,
      lineTotalCents: 3600
    })
    assert.equal(quote.subtotalCents, 3600)
    assert.equal(quote.taxCents, 180)
    assert.equal(quote.totalCents, 3780)

    const sale = service.completeCheckout({
      items,
      tenders: [{ type: 'cash', amountCents: 3780 }]
    }).sale
    assert.equal(sale.items[0]?.productId, null)
    assert.equal(sale.items[0]?.sku, '')
    assert.equal(sale.items[0]?.name, 'Photo Studio Shoot')
    assert.equal(sale.items[0]?.originalUnitPriceCents, 2000)
    assert.equal(sale.items[0]?.unitPriceCents, 1800)
    assert.equal(sale.items[0]?.priceOverrideReason, 'Package rate')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 0)

    setSaleTimestamp(database, sale.id, localTimestamp(2025, 3, 9))
    assert.deepEqual(service.productsForDay('2025-03-09'), [
      {
        productId: null,
        sku: '',
        name: 'Photo Studio Shoot',
        netQuantity: 2,
        netAmountCents: 3600
      }
    ])
  })
})

test('custom return items use configured taxes and never restock products', () => {
  withSales(({ database, taxes, service }) => {
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])
    const items = [
      {
        customItem: { name: 'Photo Studio Shoot', unitPriceCents: 2000 },
        quantity: 2,
        restock: false as const
      }
    ]
    const quote = service.quoteReturn({ reason: 'Manual refund', items })
    assert.equal(quote.subtotalCents, -4000)
    assert.equal(quote.taxCents, -200)
    assert.equal(quote.totalCents, -4200)
    assert.equal(quote.items[0]?.productId, null)
    assert.equal(quote.items[0]?.restock, false)

    const returned = service.completeReturn({
      reason: 'Manual refund',
      items,
      tenders: [{ type: 'cash', amountCents: 4200 }]
    }).return
    assert.equal(returned.totalCents, -4200)
    assert.equal(returned.returnReason, 'Manual refund')
    assert.deepEqual(
      returned.items.map((item) => [
        item.productId,
        item.sku,
        item.name,
        item.unitPriceCents,
        item.lineTotalCents,
        item.restockRequested,
        item.restockedQuantity
      ]),
      [[null, '', 'Photo Studio Shoot', -2000, -4000, false, 0]]
    )
    assert.equal(returned.payments[0]?.amountAppliedCents, -4200)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM products').get()?.count, 0)
  })
})

test('validates custom item names, amounts, and return restocking at the service boundary', () => {
  withSales(({ service }) => {
    assertSaleError(
      toSalesResult(() =>
        service.quote([{ customItem: { name: '  ', unitPriceCents: 100 }, quantity: 1 }])
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.quote([{ customItem: { name: 'Photo Shoot', unitPriceCents: -1 }, quantity: 1 }])
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.quoteReturn({
          reason: 'Manual refund',
          items: [
            {
              customItem: { name: 'Photo Shoot', unitPriceCents: 100 },
              quantity: 1,
              restock: true
            }
          ]
        })
      ),
      'invalid-input'
    )
  })
})

test('transaction price overrides change the saved line and tax without changing the catalog', () => {
  withSales(({ database, products, taxes, service }) => {
    const productId = createProduct(products, {
      sku: 'OVERRIDE',
      name: 'Price adjusted item',
      priceCents: 500,
      stockQuantity: 4
    })
    taxes.save([{ name: 'GST', rateBasisPoints: 1000 }])
    const items = [
      {
        productId,
        quantity: 2,
        priceOverride: { unitPriceCents: 250, reason: 'Price match' }
      }
    ]
    const quote = service.quote(items)
    assert.equal(quote.items[0]?.catalogUnitPriceCents, 500)
    assert.equal(quote.items[0]?.unitPriceCents, 250)
    assert.equal(quote.subtotalCents, 500)
    assert.equal(quote.taxCents, 50)

    const checkout = service.completeCheckout({
      items,
      tenders: [{ type: 'cash', amountCents: 600 }]
    })
    const savedItem = service.getById(checkout.sale.id).items[0]!
    assert.equal(savedItem.originalUnitPriceCents, 500)
    assert.equal(savedItem.unitPriceCents, 250)
    assert.equal(savedItem.priceOverrideReason, 'Price match')
    assert.equal(savedItem.lineTotalCents, 500)
    assert.deepEqual(checkout.sale.payments, [
      { type: 'cash', amountTenderedCents: 600, amountAppliedCents: 550, changeCents: 50 }
    ])
    assert.equal(
      (
        database.prepare('SELECT price_cents FROM products WHERE id = ?').get(productId) as {
          price_cents: number
        }
      ).price_cents,
      500
    )
    const saleYear = Number(checkout.sale.createdAt.slice(0, 4))
    const report = service.report({ type: 'year', year: saleYear })
    assert.equal(report.totals.cashReceivedCents, 550)
    assert.equal(report.totals.cardReceivedCents, 0)

    products.update(productId, {
      sku: 'OVERRIDE',
      name: 'Renamed after sale',
      priceCents: 700,
      stockQuantity: 4
    })
    const historicalItem = service.getById(checkout.sale.id).items[0]!
    assert.equal(historicalItem.name, 'Price adjusted item')
    assert.equal(historicalItem.originalUnitPriceCents, 500)
    assert.equal(historicalItem.unitPriceCents, 250)
    assert.equal(historicalItem.priceOverrideReason, 'Price match')
  })
})

test('validates override prices and requires a non-empty reason', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'BAD-OVERRIDE',
      name: 'Bad override item',
      priceCents: 100
    })
    assertSaleError(
      toSalesResult(() =>
        service.quote([
          { productId, quantity: 1, priceOverride: { unitPriceCents: -1, reason: 'Mistake' } }
        ])
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.quote([
          { productId, quantity: 1, priceOverride: { unitPriceCents: 50, reason: '   ' } }
        ])
      ),
      'invalid-input'
    )
  })
})

test('records split tender amounts and summarizes cash and card applied totals', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'SPLIT',
      name: 'Split payment item',
      priceCents: 1000
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [
        { type: 'cash', amountCents: 200 },
        { type: 'debit', amountCents: 300 },
        { type: 'credit', amountCents: 500 }
      ]
    })
    assert.equal(checkout.sale.paymentMethod, 'split')
    assert.deepEqual(
      checkout.sale.payments.map(
        ({ type, amountTenderedCents, amountAppliedCents, changeCents }) => [
          type,
          amountTenderedCents,
          amountAppliedCents,
          changeCents
        ]
      ),
      [
        ['cash', 200, 200, 0],
        ['debit', 300, 300, 0],
        ['credit', 500, 500, 0]
      ]
    )
    const report = service.report({
      type: 'year',
      year: Number(checkout.sale.createdAt.slice(0, 4))
    })
    assert.equal(report.totals.cashReceivedCents, 200)
    assert.equal(report.totals.cardReceivedCents, 800)
  })
})

test('completes a fully charged sale and saves customer details', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CHARGE-FULL',
      name: 'Charged item',
      priceCents: 1000
    })
    const customerId = createCustomer(database, {
      firstName: 'Alex',
      lastName: 'Customer',
      companyName: 'Example Co',
      address: '12 Main Street',
      phoneNumber: '604-555-0100',
      email: 'alex@example.com'
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [],
      customerId,
      chargeRemainingBalance: true
    })

    assert.equal(checkout.sale.paymentMethod, 'charge')
    assert.equal(checkout.sale.chargeAmountCents, 1000)
    assert.equal(checkout.sale.chargeBalanceCents, 1000)
    assert.deepEqual(checkout.sale.customer, {
      id: customerId,
      name: 'Alex Customer',
      companyName: 'Example Co'
    })
    assert.deepEqual(checkout.sale.charge, {
      customer: {
        name: 'Alex Customer',
        companyName: 'Example Co',
        address: '12 Main Street',
        phoneNumber: '604-555-0100',
        email: 'alex@example.com'
      },
      amountCents: 1000,
      balanceCents: 1000,
      payments: []
    })
    assert.deepEqual(checkout.sale.payments, [])
    assert.match(serializeSalesCsv([checkout.sale]), /Charge: 10\.00, balance due 10\.00/)
  })
})

test('charges the balance left after a partial cash payment', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CHARGE-SPLIT',
      name: 'Split charge item',
      priceCents: 1000
    })
    const customerId = createCustomer(database, {
      firstName: 'Jordan',
      lastName: 'Customer'
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: 400 }],
      customerId,
      chargeRemainingBalance: true
    })

    assert.equal(checkout.sale.paymentMethod, 'split')
    assert.equal(checkout.sale.chargeAmountCents, 600)
    assert.equal(checkout.sale.chargeBalanceCents, 600)
    assert.equal(checkout.sale.payments[0]?.amountAppliedCents, 400)
    assert.match(
      serializeSalesCsv([checkout.sale]),
      /Cash: tendered 4\.00, applied 4\.00, change 0\.00; Charge: 6\.00, balance due 6\.00/
    )
  })
})

test('records partial and final charge repayments by tender and rejects overpayment', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CHARGE-REPAY',
      name: 'Repayment item',
      priceCents: 1000
    })
    const customerId = createCustomer(database, {
      firstName: 'Taylor',
      lastName: 'Customer'
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [],
      customerId,
      chargeRemainingBalance: true
    })
    const partial = service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'cash',
      amountCents: 250
    })
    assert.equal(partial.charge?.balanceCents, 750)
    assert.equal(partial.charge?.payments.length, 1)

    assertSaleError(
      toSalesResult(() =>
        service.recordChargePayment({
          saleId: checkout.sale.id,
          type: 'debit',
          amountCents: 751
        })
      ),
      'invalid-input'
    )

    const secondPartial = service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'etransfer',
      amountCents: 250
    })
    assert.equal(secondPartial.charge?.balanceCents, 500)

    const paid = service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'check',
      amountCents: 500
    })
    assert.equal(paid.charge?.balanceCents, 0)
    assert.deepEqual(
      paid.charge?.payments.map(({ type, amountCents }) => [type, amountCents]),
      [
        ['cash', 250],
        ['etransfer', 250],
        ['check', 500]
      ]
    )
    assert.equal(paid.chargeBalanceCents, 0)
  })
})

test('counts charge repayments in reports on the date they are received', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CHARGE-REPORT',
      name: 'Report item',
      priceCents: 1000
    })
    const customerId = createCustomer(database, {
      firstName: 'Morgan',
      lastName: 'Customer'
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [],
      customerId,
      chargeRemainingBalance: true
    })
    setSaleTimestamp(database, checkout.sale.id, '2020-01-01 12:00:00')
    service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'etransfer',
      amountCents: 300
    })
    service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'check',
      amountCents: 200
    })
    database
      .prepare('UPDATE charge_payments SET created_at = ? WHERE payment_type = ?')
      .run('2099-06-15 12:00:00', 'etransfer')
    database
      .prepare('UPDATE charge_payments SET created_at = ? WHERE payment_type = ?')
      .run('2099-06-16 12:00:00', 'check')

    const saleYear = service.report({ type: 'year', year: 2020 })
    const repaymentYear = service.report({ type: 'year', year: 2099 })
    const eTransferDay = service.report({ type: 'day', date: '2099-06-15' })
    const checkDay = service.report({ type: 'day', date: '2099-06-16' })
    assert.equal(saleYear.totals.grossSalesTotalCents, 1000)
    assert.equal(saleYear.totals.cashReceivedCents, 0)
    assert.equal(repaymentYear.totals.transactionCount, 0)
    assert.equal(repaymentYear.totals.etransferReceivedCents, 300)
    assert.equal(repaymentYear.totals.checkReceivedCents, 200)
    assert.equal(eTransferDay.totals.etransferReceivedCents, 300)
    assert.equal(eTransferDay.totals.checkReceivedCents, 0)
    assert.equal(checkDay.totals.checkReceivedCents, 200)
  })
})

test('requires a saved customer and a real remaining balance for Charge', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CHARGE-VALIDATION',
      name: 'Validation item',
      priceCents: 1000
    })
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [],
          chargeRemainingBalance: true
        })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'etransfer', amountCents: 1000 }]
        })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'cash', amountCents: 1000 }],
          customerId: createCustomer(database, { firstName: 'Alex', lastName: 'Customer' }),
          chargeRemainingBalance: true
        })
      ),
      'invalid-input'
    )
    const settled = completeWithPayment(service, [{ productId, quantity: 1 }])
    assertSaleError(
      toSalesResult(() =>
        service.recordChargePayment({
          saleId: settled.sale.id,
          type: 'cash',
          amountCents: 100
        })
      ),
      'invalid-input'
    )
  })
})

test('rejects uncovered sales and card overpayment without writing a sale', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'PAYMENT-VALIDATION',
      name: 'Payment validation item',
      priceCents: 1000
    })
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'cash', amountCents: 300 }]
        })
      ),
      'insufficient-payment'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'credit', amountCents: 1001 }]
        })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'cash', amountCents: 0 }]
        })
      ),
      'invalid-input'
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)
  })
})

test('completes a zero-total sale without requiring a payment entry', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'FREE',
      name: 'Free item',
      priceCents: 0
    })
    const checkout = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: []
    })
    assert.equal(checkout.sale.totalCents, 0)
    assert.equal(checkout.sale.paymentMethod, 'none')
    assert.deepEqual(checkout.sale.payments, [])
  })
})

test('rolls back sale, item, tender, and stock writes when a tender insert fails', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'TENDER-ROLLBACK',
      name: 'Tender rollback item',
      priceCents: 300,
      stockQuantity: 4
    })
    database.exec(`CREATE TRIGGER fail_sale_payment BEFORE INSERT ON sale_payments
      BEGIN SELECT RAISE(ABORT, 'forced payment write failure'); END;`)

    assert.throws(
      () =>
        service.completeCheckout({
          items: [{ productId, quantity: 2 }],
          tenders: [{ type: 'cash', amountCents: 600 }]
        }),
      /forced payment write failure/
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sale_items').get()?.count, 0)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sale_payments').get()?.count, 0)
    assert.equal(
      (
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId) as {
          stock_quantity: number
        }
      ).stock_quantity,
      4
    )
  })
})

test('decrements tracked stock, allows exact stock, and leaves untracked stock alone', () => {
  withSales(({ database, products, service }) => {
    const trackedId = createProduct(products, {
      sku: 'TRACKED',
      name: 'Tracked',
      priceCents: 50,
      stockQuantity: 2
    })
    const untrackedId = createProduct(products, {
      sku: 'UNTRACKED',
      name: 'Untracked',
      priceCents: 25,
      stockQuantity: null
    })

    completeWithPayment(
      service,
      [
        { productId: trackedId, quantity: 2 },
        { productId: untrackedId, quantity: 100 }
      ],
      'card'
    )

    assert.equal(
      database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(trackedId)
        ?.stock_quantity,
      0
    )
    assert.equal(
      database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(untrackedId)
        ?.stock_quantity,
      null
    )
  })
})

test('rejects empty, malformed, inactive, unavailable, and insufficient-stock checkouts', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'LIMITED',
      name: 'Limited item',
      priceCents: 99,
      stockQuantity: 1
    })

    assertSaleError(
      toSalesResult(() => service.quote([])),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({ items: [{ productId, quantity: 0 }], tenders: [] })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'cheque', amountCents: 99 }]
        })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() => service.quote([{ productId: 999, quantity: 1 }])),
      'unavailable-product'
    )

    const insufficient = toSalesResult(() =>
      service.completeCheckout({
        items: [{ productId, quantity: 2 }],
        tenders: [{ type: 'cash', amountCents: 999 }]
      })
    )
    assertSaleError(insufficient, 'insufficient-stock')

    products.setActive(productId, false)
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          tenders: [{ type: 'cash', amountCents: 999 }]
        })
      ),
      'unavailable-product'
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)
  })
})

test('rolls back sale and stock changes when writing a historical item fails', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'ROLLBACK',
      name: 'Rollback item',
      priceCents: 300,
      stockQuantity: 4
    })
    database.exec(`CREATE TRIGGER fail_sale_item BEFORE INSERT ON sale_items
      BEGIN SELECT RAISE(ABORT, 'forced item write failure'); END;`)

    assert.throws(
      () => completeWithPayment(service, [{ productId, quantity: 2 }]),
      /forced item write failure/
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 0)
    assert.equal(
      database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId)
        ?.stock_quantity,
      4
    )
  })
})

test('lists newest sales first and reports historical item counts', () => {
  withSales(({ products, service }) => {
    const productId = createProduct(products, {
      sku: 'HISTORY',
      name: 'History item',
      priceCents: 199
    })
    const first = completeWithPayment(service, [{ productId, quantity: 1 }])
    const second = completeWithPayment(service, [{ productId, quantity: 2 }], 'card')

    assert.deepEqual(
      service.listRecent().map(({ id, itemCount }) => [id, itemCount]),
      [
        [second.sale.id, 1],
        [first.sale.id, 1]
      ]
    )
  })
})

test('daily product summaries net returns, preserve overrides, and group by local day and product identity', () => {
  const previousTimeZone = process.env.TZ
  process.env.TZ = 'America/Vancouver'

  try {
    withSales(({ database, products, service }) => {
      const widgetId = createProduct(products, {
        sku: 'WIDGET-OLD',
        name: 'Widget',
        priceCents: 1500
      })
      const historicId = createProduct(products, {
        sku: 'HISTORIC',
        name: 'Historic item',
        priceCents: 500
      })
      const boundaryId = createProduct(products, {
        sku: 'DAY-START',
        name: 'Day start item',
        priceCents: 99
      })

      const boundarySale = service.completeCheckout({
        items: [{ productId: boundaryId, quantity: 1 }],
        tenders: [
          { type: 'cash', amountCents: 49 },
          { type: 'debit', amountCents: 50 }
        ]
      })
      setSaleTimestamp(database, boundarySale.sale.id, localTimestamp(2025, 3, 9, 0))

      const sale = completeWithPayment(service, [
        {
          productId: widgetId,
          quantity: 3,
          priceOverride: { unitPriceCents: 1100, reason: 'Manager adjustment' }
        }
      ])
      setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 3, 9, 23))

      const historic = completeWithPayment(service, [
        {
          productId: historicId,
          quantity: 1,
          priceOverride: { unitPriceCents: 750, reason: 'Sale price' }
        }
      ])
      setSaleTimestamp(database, historic.sale.id, localTimestamp(2025, 3, 9, 12))
      database
        .prepare('UPDATE sale_items SET product_id = NULL WHERE sale_id = ?')
        .run(historic.sale.id)

      products.update(widgetId, {
        sku: 'WIDGET-NEW',
        name: 'Updated widget',
        priceCents: 2000,
        stockQuantity: null
      })
      const returned = service.completeReturn({
        reason: 'Customer return',
        items: [{ productId: widgetId, quantity: 1, restock: false }],
        tenders: [{ type: 'cash', amountCents: 2000 }]
      })
      setSaleTimestamp(database, returned.return.id, localTimestamp(2025, 3, 9, 23, 30))

      const nextDaySale = completeWithPayment(service, [{ productId: widgetId, quantity: 2 }])
      setSaleTimestamp(database, nextDaySale.sale.id, localTimestamp(2025, 3, 10, 0))

      const productsForMarch9 = service.productsForDay('2025-03-09')
      assert.deepEqual(
        productsForMarch9.map(({ productId, sku, name, netQuantity, netAmountCents }) => ({
          productId,
          sku,
          name,
          netQuantity,
          netAmountCents
        })),
        [
          {
            productId: boundaryId,
            sku: 'DAY-START',
            name: 'Day start item',
            netQuantity: 1,
            netAmountCents: 99
          },
          {
            productId: null,
            sku: 'HISTORIC',
            name: 'Historic item',
            netQuantity: 1,
            netAmountCents: 750
          },
          {
            productId: widgetId,
            sku: 'WIDGET-NEW',
            name: 'Updated widget',
            netQuantity: 2,
            netAmountCents: 1300
          }
        ]
      )
      assert.deepEqual(
        service
          .productsForDay('2025-03-10')
          .map(({ netQuantity, netAmountCents }) => [netQuantity, netAmountCents]),
        [[2, 4000]]
      )
      assert.deepEqual(
        service
          .productsByDayInPeriod({
            type: 'custom',
            startDate: '2025-03-09',
            endDate: '2025-03-10'
          })
          .map(({ date, products }) => [
            date,
            products.map(({ netQuantity, netAmountCents }) => [netQuantity, netAmountCents])
          ]),
        [
          ['2025-03-10', [[2, 4000]]],
          [
            '2025-03-09',
            [
              [1, 99],
              [1, 750],
              [2, 1300]
            ]
          ]
        ]
      )
      assertSaleError(
        toSalesResult(() => service.productsForDay('2025-02-30')),
        'invalid-period'
      )
    })
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})

test('resolves day, month, year, and inclusive custom date periods in local time', () => {
  const day = resolveSalesPeriod({ type: 'day', date: '2025-03-09' })
  const month = resolveSalesPeriod({ type: 'month', month: '2025-03' })
  const year = resolveSalesPeriod({ type: 'year', year: 2025 })
  const custom = resolveSalesPeriod({
    type: 'custom',
    startDate: '2025-03-09',
    endDate: '2025-03-10'
  })

  assert.equal(day.fileName, 'sales-2025-03-09.csv')
  assert.equal(month.fileName, 'sales-2025-03.csv')
  assert.equal(year.fileName, 'sales-2025.csv')
  assert.equal(custom.fileName, 'sales-2025-03-09-to-2025-03-10.csv')
  assert.equal(day.startInclusive, localTimestamp(2025, 3, 9, 0))
  assert.equal(day.endExclusive, localTimestamp(2025, 3, 10, 0))
  assert.equal(month.startInclusive, localTimestamp(2025, 3, 1, 0))
  assert.equal(month.endExclusive, localTimestamp(2025, 4, 1, 0))
  assert.equal(year.startInclusive, localTimestamp(2025, 1, 1, 0))
  assert.equal(year.endExclusive, localTimestamp(2026, 1, 1, 0))
  assert.equal(custom.startInclusive, localTimestamp(2025, 3, 9, 0))
  assert.equal(custom.endExclusive, localTimestamp(2025, 3, 11, 0))
})

test('sales report filters all supported periods and includes both custom endpoints', () => {
  withSales(({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'REPORT',
      name: 'Report item',
      priceCents: 100
    })
    const createAt = (date: [number, number, number], paymentMethod: 'cash' | 'card'): number => {
      const sale = completeWithPayment(service, [{ productId, quantity: 1 }], paymentMethod)
      setSaleTimestamp(database, sale.sale.id, localTimestamp(...date))
      return sale.sale.id
    }

    const dec31 = createAt([2024, 12, 31], 'cash')
    const jan1 = createAt([2025, 1, 1], 'card')
    const mar31 = createAt([2025, 3, 31], 'cash')
    const apr1 = createAt([2025, 4, 1], 'card')
    const nextYear = createAt([2026, 1, 1], 'card')

    const day = service.report({ type: 'day', date: '2025-03-31' })
    const month = service.report({ type: 'month', month: '2025-03' })
    const year = service.report({ type: 'year', year: 2025 })
    const custom = service.report({
      type: 'custom',
      startDate: '2024-12-31',
      endDate: '2025-01-01'
    })

    assert.deepEqual(
      day.sales.map((sale) => sale.id),
      [mar31]
    )
    assert.deepEqual(
      month.sales.map((sale) => sale.id),
      [mar31]
    )
    assert.deepEqual(
      year.sales.map((sale) => sale.id),
      [apr1, mar31, jan1]
    )
    assert.equal(
      year.sales.some((sale) => sale.id === nextYear),
      false
    )
    assert.deepEqual(
      custom.sales.map((sale) => sale.id),
      [jan1, dec31]
    )
  })
})

test('sales reports and PDF exports include more than 100 transactions', async () => {
  await withSales(async ({ database, products, service, taxes }) => {
    const productId = createProduct(products, {
      sku: 'BULK-REPORT',
      name: 'Bulk report item',
      priceCents: 100
    })
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])

    for (let index = 0; index < 101; index += 1) {
      const paymentMethod = index % 2 === 0 ? 'cash' : 'card'
      const sale = completeWithPayment(service, [{ productId, quantity: 1 }], paymentMethod)
      setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 6, 15, 12))
    }

    const report = service.report({ type: 'year', year: 2025 })
    assert.equal(report.sales.length, 101)
    assert.equal(report.totals.saleCount, 101)
    assert.equal(report.totals.grossSalesSubtotalCents, 10100)
    assert.equal(report.totals.grossSalesTaxCents, 505)
    assert.equal(report.totals.grossSalesTotalCents, 10605)
    assert.equal(report.totals.cashReceivedCents, 5355)
    assert.equal(report.totals.cardReceivedCents, 5250)
    assert.ok(report.sales[0]!.id > report.sales[100]!.id)

    let pdfHtml = ''
    const exporter = createSalesExportService(
      service,
      async () => true,
      async (_fileName, html) => {
        pdfHtml = html
        return true
      }
    )
    const pdf = await exporter.exportPdf({ type: 'year', year: 2025 }, ['overview'])
    assert.deepEqual(pdf, { canceled: false, rowCount: 101 })
    assert.equal((pdfHtml.match(/class="transaction-number"/g) ?? []).length, 101)
    assert.match(pdfHtml, /Net quantity/)
  })
})

test('sales report rejects invalid dates and reversed custom ranges', () => {
  withSales(({ service }) => {
    assertSaleError(
      toSalesResult(() => service.report({ type: 'day', date: '2025-02-30' })),
      'invalid-period'
    )
    assertSaleError(
      toSalesResult(() =>
        service.report({ type: 'custom', startDate: '2025-03-02', endDate: '2025-03-01' })
      ),
      'invalid-period'
    )
  })
})

test('CSV export includes period tender totals and reports save cancellation or failure', async () => {
  await withSales(async ({ database, products, service }) => {
    const productId = createProduct(products, {
      sku: 'CSV',
      name: 'CSV item',
      priceCents: 125
    })
    const sale = service.completeCheckout({
      items: [{ productId, quantity: 2 }],
      tenders: [{ type: 'cash', amountCents: 300 }]
    })
    setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 3, 9))

    let savedName = ''
    let savedContents = ''
    const exporter = createSalesExportService(service, async (fileName, contents) => {
      savedName = fileName
      savedContents = contents
      return true
    })
    const exported = await exporter.exportCsv({ type: 'day', date: '2025-03-09' })
    assert.deepEqual(exported, { canceled: false, rowCount: 1 })
    assert.equal(savedName, 'sales-2025-03-09.csv')
    assert.match(
      savedContents,
      /^transaction_type,transaction_number,created_at_local,payment_method,payment_breakdown,return_reason,item_count,subtotal_cad,tax_cad,total_cad\r\n/
    )
    assert.equal(
      savedContents.split('\r\n')[1],
      `sale,Invoice #${sale.sale.transactionNumber},2025-03-09 12:00:00,cash,"Cash: tendered 3.00, applied 2.50, change 0.50",,1,2.50,0.00,2.50`
    )
    assert.match(savedContents, /report_total,,,Cash,Cash received,,,,,2\.50/)
    assert.match(savedContents, /report_total,,,E-transfer,E-transfer received,,,,,0\.00/)
    assert.match(savedContents, /report_total,,,Check,Check received,,,,,0\.00/)
    assert.match(savedContents, /report_total,,,Net,Net subtotal,,,2\.50,,/)
    assert.match(savedContents, /report_total,,,Net,Net tax,,,,0\.00,/)
    assert.match(savedContents, /report_total,,,Net,Net total,,,,,2\.50/)

    const canceledExporter = createSalesExportService(service, async () => false)
    assert.deepEqual(await canceledExporter.exportCsv({ type: 'day', date: '2025-03-09' }), {
      canceled: true
    })

    const failedExporter = createSalesExportService(service, async () => {
      throw new Error('write failed')
    })
    assertSaleError(
      await toSalesResultAsync(() => failedExporter.exportCsv({ type: 'day', date: '2025-03-09' })),
      'export-failed'
    )
  })
})

test('sales reports and PDFs include net transaction totals and tax totals by tax name', async () => {
  await withSales(async ({ database, products, service, taxes }) => {
    taxes.save([
      { name: 'GST', rateBasisPoints: 500 },
      { name: 'PST', rateBasisPoints: 700 }
    ])
    const productId = createProduct(products, {
      sku: 'TAX-REPORT',
      name: 'Tax report item',
      priceCents: 1000
    })
    const sale = completeWithPayment(service, [{ productId, quantity: 2 }])
    setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 3, 9, 10))
    const returnItems = [{ productId, quantity: 1, restock: false }]
    const returnQuote = service.quoteReturn({ reason: 'Partial return', items: returnItems })
    const returned = service.completeReturn({
      reason: 'Partial return',
      items: returnItems,
      tenders: [{ type: 'credit', amountCents: -returnQuote.totalCents }]
    })
    setSaleTimestamp(database, returned.return.id, localTimestamp(2025, 3, 9, 11))

    const period = { type: 'day' as const, date: '2025-03-09' }
    const report = service.report(period)
    assert.equal(report.totals.netSubtotalCents, 1000)
    assert.equal(report.totals.netTaxCents, 120)
    assert.equal(report.totals.netTotalCents, 1120)
    assert.deepEqual(report.taxTotals, [
      { taxName: 'GST', salesTaxCents: 100, returnsTaxCents: -50, netTaxCents: 50 },
      { taxName: 'PST', salesTaxCents: 140, returnsTaxCents: -70, netTaxCents: 70 }
    ])
    assert.equal(
      report.taxTotals.reduce((sum, tax) => sum + tax.netTaxCents, 0),
      report.totals.netTaxCents
    )

    const csv = serializeSalesCsv(report.sales, report.totals)
    assert.match(csv, /report_total,,,Net,Net subtotal,,,10\.00,,/)
    assert.match(csv, /report_total,,,Net,Net tax,,,,1\.20,/)
    assert.match(csv, /report_total,,,Net,Net total,,,,,11\.20/)

    let pdfHtml = ''
    let pdfFileName = ''
    const exporter = createSalesExportService(
      service,
      async () => true,
      async (fileName, html) => {
        pdfFileName = fileName
        pdfHtml = html
        return true
      }
    )
    const result = await exporter.exportPdf(period, [])
    assert.deepEqual(result, { canceled: false, rowCount: 2 })
    assert.equal(pdfFileName, 'sales-itemized-2025-03-09.pdf')
    assert.match(pdfHtml, /Itemized sales report/)
    assert.match(pdfHtml, /<h2>Transactions<\/h2>/)
    assert.match(pdfHtml, /Net subtotal/)
    assert.match(pdfHtml, /\$10\.00/)
    assert.match(pdfHtml, /GST net tax/)
    assert.match(pdfHtml, /\$0\.50/)
    assert.match(pdfHtml, /PST net tax/)
    assert.match(pdfHtml, /\$0\.70/)
    assert.doesNotMatch(pdfHtml, />Net tax</)
    assert.match(pdfHtml, /Net total/)
    assert.match(pdfHtml, /\$11\.20/)
    assert.match(pdfHtml, /Cash received/)
    assert.match(pdfHtml, /<span>Cash received<\/span><strong>\$22\.40<\/strong>/)
    assert.match(pdfHtml, /Debit received/)
    assert.match(pdfHtml, /Credit received/)
    assert.match(pdfHtml, /E-transfer received/)
    assert.match(pdfHtml, /Check received/)
    assert.match(
      pdfHtml,
      /<td>GST<\/td>\s*<td>\$1\.00<\/td>\s*<td>-\$0\.50<\/td>\s*<td>\$0\.50<\/td>/
    )
    assert.match(
      pdfHtml,
      /<td>PST<\/td>\s*<td>\$1\.40<\/td>\s*<td>-\$0\.70<\/td>\s*<td>\$0\.70<\/td>/
    )

    const summaryResult = await exporter.exportPdf(period, [], 'summary')
    assert.deepEqual(summaryResult, { canceled: false, rowCount: 2 })
    assert.equal(pdfFileName, 'sales-summary-2025-03-09.pdf')
    assert.match(pdfHtml, /Summary sales report/)
    assert.doesNotMatch(pdfHtml, /<h2>Transactions<\/h2>/)
    assert.doesNotMatch(pdfHtml, /<h2>Tax totals by type<\/h2>/)
    assert.doesNotMatch(pdfHtml, /<h2>Payments received by tender<\/h2>/)
    assert.doesNotMatch(pdfHtml, /<h2>Item totals for the period<\/h2>/)
    assert.doesNotMatch(pdfHtml, /<h2>Charge repayments received in this period<\/h2>/)
    assert.match(pdfHtml, /<section class="summary-section">[\s\S]*<\/section>\s*<\/body>/)
  })
})

test('PDF item totals allocate tax and split tenders by product and date charge repayments', async () => {
  await withSales(async ({ database, products, service, taxes }) => {
    taxes.save([
      { name: 'GST', rateBasisPoints: 500 },
      { name: 'PST', rateBasisPoints: 700 }
    ])
    const firstProductId = createProduct(products, {
      sku: 'ITEM-1',
      name: 'First item',
      priceCents: 1001
    })
    const secondProductId = createProduct(products, {
      sku: 'ITEM-2',
      name: 'Second item',
      priceCents: 2009
    })
    const saleQuote = service.quote([
      { productId: firstProductId, quantity: 1 },
      { productId: secondProductId, quantity: 1 }
    ])
    const customerId = createCustomer(database, { firstName: 'Morgan', lastName: 'Customer' })
    const checkout = service.completeCheckout({
      items: [
        { productId: firstProductId, quantity: 1 },
        { productId: secondProductId, quantity: 1 }
      ],
      tenders: [
        { type: 'cash', amountCents: 400 },
        { type: 'debit', amountCents: 500 },
        { type: 'credit', amountCents: 600 }
      ],
      customerId,
      chargeRemainingBalance: true
    })
    assert.equal(checkout.sale.chargeAmountCents, saleQuote.totalCents - 1500)
    setSaleTimestamp(database, checkout.sale.id, '2025-03-09 12:00:00')

    const returnQuote = service.quoteReturn({
      reason: 'Returned first item',
      items: [{ productId: firstProductId, quantity: 1, restock: false }]
    })
    const returned = service.completeReturn({
      reason: 'Returned first item',
      items: [{ productId: firstProductId, quantity: 1, restock: false }],
      tenders: [{ type: 'cash', amountCents: -returnQuote.totalCents }]
    })
    setSaleTimestamp(database, returned.return.id, '2025-03-09 13:00:00')

    service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'etransfer',
      amountCents: 250
    })
    service.recordChargePayment({
      saleId: checkout.sale.id,
      type: 'check',
      amountCents: 200
    })
    database
      .prepare('UPDATE charge_payments SET created_at = ? WHERE payment_type = ?')
      .run('2025-03-10 10:00:00', 'etransfer')
    database
      .prepare('UPDATE charge_payments SET created_at = ? WHERE payment_type = ?')
      .run('2025-03-10 11:00:00', 'check')

    const period = { type: 'custom' as const, startDate: '2025-03-09', endDate: '2025-03-10' }
    const report = service.report(period)
    const financials = service.productsWithFinancialsInPeriod(period, report.sales)
    assert.deepEqual(
      financials.products.map((product) => ({
        name: product.name,
        netQuantity: product.netQuantity,
        subtotalCents: product.subtotalCents,
        taxes: product.taxAmounts.map(({ name, amountCents }) => [name, amountCents]),
        totalCents: product.totalCents,
        tenders: product.tenderAmounts
      })),
      [
        {
          name: 'First item',
          netQuantity: 0,
          subtotalCents: 0,
          taxes: [
            ['GST', 0],
            ['PST', 0]
          ],
          totalCents: 0,
          tenders: { cash: -989, debit: 166, credit: 200, charge: 623 }
        },
        {
          name: 'Second item',
          netQuantity: 1,
          subtotalCents: 2009,
          taxes: [
            ['GST', 101],
            ['PST', 141]
          ],
          totalCents: 2251,
          tenders: { cash: 268, debit: 334, credit: 400, charge: 1249 }
        }
      ]
    )
    assert.equal(
      financials.products.reduce((sum, product) => sum + product.totalCents, 0),
      2251
    )
    assert.equal(
      financials.products.reduce((sum, product) => sum + product.tenderAmounts.charge, 0),
      saleQuote.totalCents - 1500
    )
    for (const tax of report.taxTotals) {
      assert.equal(
        financials.products.reduce(
          (sum, product) =>
            sum +
            (product.taxAmounts.find((itemTax) => itemTax.name === tax.taxName)?.amountCents ?? 0),
          0
        ),
        tax.netTaxCents
      )
    }
    assert.equal(
      financials.products.reduce((sum, product) => sum + product.tenderAmounts.cash, 0),
      report.totals.cashNetCents
    )
    assert.equal(
      financials.products.reduce((sum, product) => sum + product.tenderAmounts.debit, 0),
      report.totals.debitNetCents
    )
    assert.equal(
      financials.products.reduce((sum, product) => sum + product.tenderAmounts.credit, 0),
      report.totals.creditNetCents
    )
    for (const product of financials.products) {
      assert.equal(
        Object.values(product.tenderAmounts).reduce((sum, amount) => sum + amount, 0),
        product.totalCents
      )
    }
    assert.deepEqual(
      financials.chargeRepayments.map(({ type, amountCents, createdAt }) => [
        type,
        amountCents,
        createdAt
      ]),
      [
        ['etransfer', 250, '2025-03-10 10:00:00'],
        ['check', 200, '2025-03-10 11:00:00']
      ]
    )

    let pdfHtml = ''
    const exporter = createSalesExportService(
      service,
      async () => true,
      async (_fileName, html) => {
        pdfHtml = html
        return true
      }
    )
    await exporter.exportPdf(period, [], 'summary')
    assert.match(pdfHtml, /Summary sales report/)
    assert.doesNotMatch(pdfHtml, /<h2>Item totals for the period<\/h2>/)
    assert.doesNotMatch(pdfHtml, /<h2>Charge repayments received in this period<\/h2>/)

    await exporter.exportPdf(period, [], 'itemized')
    assert.match(pdfHtml, /Itemized sales report/)
    assert.match(pdfHtml, /<h2>Transactions<\/h2>/)
    assert.match(pdfHtml, /<h2>Item totals for the period<\/h2>/)
    assert.match(pdfHtml, /GST tax/)
    assert.match(pdfHtml, /PST tax/)
    assert.match(pdfHtml, /Charge at sale/)
    assert.match(pdfHtml, /Total repayments/)
    assert.match(pdfHtml, /E-transfer/)
    assert.match(pdfHtml, /Check/)
    assert.match(pdfHtml, /10\/03\/25/)
    assert.match(pdfHtml, /Charge shows the amount left unpaid at sale/)
    assert.match(pdfHtml, /<td class="number">\$22\.51<\/td>/)
  })
})

test('sales report reconciles legacy combined tax as unitemized tax', () => {
  withSales(({ database, products, service, taxes }) => {
    taxes.save([{ name: 'GST', rateBasisPoints: 500 }])
    const productId = createProduct(products, {
      sku: 'LEGACY-TAX',
      name: 'Legacy tax item',
      priceCents: 1000
    })
    const sale = completeWithPayment(service, [{ productId, quantity: 1 }])
    setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 3, 9))
    database.prepare('DELETE FROM sale_taxes WHERE sale_id = ?').run(sale.sale.id)

    const report = service.report({ type: 'day', date: '2025-03-09' })
    assert.deepEqual(report.taxTotals, [
      {
        taxName: 'Unitemized tax',
        salesTaxCents: 50,
        returnsTaxCents: 0,
        netTaxCents: 50
      }
    ])
    assert.equal(report.taxTotals[0]!.netTaxCents, report.totals.netTaxCents)
  })
})

test('PDF report includes selected summaries, signed transaction details, and escaped daily products', async () => {
  const previousTimeZone = process.env.TZ
  process.env.TZ = 'America/Vancouver'

  try {
    await withSales(async ({ database, products, service }) => {
      const productId = createProduct(products, {
        sku: 'SKU<&>',
        name: 'Coffee <filter> & mix',
        priceCents: 1000
      })
      const sale = completeWithPayment(service, [
        {
          productId,
          quantity: 2,
          priceOverride: { unitPriceCents: 700, reason: 'One day promotion' }
        }
      ])
      setSaleTimestamp(database, sale.sale.id, localTimestamp(2025, 3, 9, 10))
      const returned = service.completeReturn({
        reason: 'Damaged <seal> & leaking',
        items: [{ productId, quantity: 1, restock: false }],
        tenders: [{ type: 'credit', amountCents: 1000 }]
      })
      setSaleTimestamp(database, returned.return.id, localTimestamp(2025, 3, 10, 11))

      let savedFileName = ''
      let savedHtml = ''
      const exporter = createSalesExportService(
        service,
        async () => true,
        async (fileName, html) => {
          savedFileName = fileName
          savedHtml = html
          return true
        }
      )
      const result = await exporter.exportPdf(
        { type: 'custom', startDate: '2025-03-09', endDate: '2025-03-10' },
        ['overview', 'net', 'etransfer', 'check']
      )

      assert.deepEqual(result, { canceled: false, rowCount: 2 })
      assert.equal(savedFileName, 'sales-itemized-2025-03-09-to-2025-03-10.pdf')
      assert.match(savedHtml, /From 09\/03\/25 through 10\/03\/25/)
      assert.match(savedHtml, /Itemized sales report/)
      assert.match(savedHtml, /Transactions/)
      assert.match(savedHtml, /Net total/)
      assert.match(savedHtml, /E-transfer received/)
      assert.match(savedHtml, /Check received/)
      assert.doesNotMatch(savedHtml, /Gross subtotal/)
      assert.match(savedHtml, /Invoice #[^<]+/)
      assert.match(savedHtml, /Return #[^<]+/)
      assert.match(savedHtml, /Damaged &lt;seal&gt; &amp; leaking/)
      assert.match(savedHtml, /Coffee &lt;filter&gt; &amp; mix/)
      assert.match(savedHtml, /SKU&lt;&amp;&gt;/)
      assert.match(savedHtml, /Item totals for the period/)
      assert.match(savedHtml, /Net amount before tax/)
      assert.match(savedHtml, /net quantity/i)
      assert.match(
        savedHtml,
        /<td>Coffee &lt;filter&gt; &amp; mix<\/td>\s*<td>SKU&lt;&amp;&gt;<\/td>\s*<td class="number">1<\/td>\s*<td class="number">\$4\.00<\/td>/
      )
      assert.doesNotMatch(savedHtml, /Products by day/)
      assert.match(savedHtml, /-\$10\.00/)
      assert.doesNotMatch(savedHtml, /One day promotion/)
      assert.doesNotMatch(savedHtml, /Damaged <seal>/)
    })
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})

test('PDF product summaries show a dash for one-time items without a SKU', async () => {
  const previousTimeZone = process.env.TZ
  process.env.TZ = 'America/Vancouver'

  try {
    await withSales(async ({ database, service }) => {
      const sale = service.completeCheckout({
        items: [
          {
            customItem: { name: 'Photo Studio Shoot', unitPriceCents: 2500 },
            quantity: 1
          }
        ],
        tenders: [{ type: 'cash', amountCents: 2500 }]
      }).sale
      setSaleTimestamp(database, sale.id, localTimestamp(2025, 3, 9))

      let savedHtml = ''
      const exporter = createSalesExportService(
        service,
        async () => true,
        async (_fileName, html) => {
          savedHtml = html
          return true
        }
      )
      const result = await exporter.exportPdf({ type: 'day', date: '2025-03-09' }, [], 'itemized')

      assert.deepEqual(result, { canceled: false, rowCount: 1 })
      assert.match(
        savedHtml,
        /<td>Photo Studio Shoot<\/td>\s*<td>—<\/td>\s*<td class="number">1<\/td>\s*<td class="number">\$25\.00<\/td>/
      )
    })
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})

test('PDF export handles empty periods, canceled saves, invalid summary groups, and write failures', async () => {
  await withSales(async ({ service }) => {
    let emptyReportHtml = ''
    const canceledExporter = createSalesExportService(
      service,
      async () => true,
      async (_fileName, html) => {
        emptyReportHtml = html
        return false
      }
    )
    const canceled = await canceledExporter.exportPdf({ type: 'day', date: '2025-03-09' }, [])
    assert.deepEqual(canceled, { canceled: true })
    assert.match(emptyReportHtml, /Itemized sales report/)
    assert.match(emptyReportHtml, /No transactions in this period/)
    assert.match(emptyReportHtml, /No product details in this period/)
    assert.match(emptyReportHtml, /<section class="summary-section">/)
    assert.match(emptyReportHtml, /Net subtotal/)
    assert.match(emptyReportHtml, /Net total/)
    assert.match(emptyReportHtml, /No tax details in this period/)

    const summaryCanceled = await canceledExporter.exportPdf(
      { type: 'day', date: '2025-03-09' },
      [],
      'summary'
    )
    assert.deepEqual(summaryCanceled, { canceled: true })
    assert.match(emptyReportHtml, /Summary sales report/)
    assert.doesNotMatch(emptyReportHtml, /<h2>Transactions<\/h2>/)
    assert.doesNotMatch(emptyReportHtml, /No transactions in this period/)
    assert.doesNotMatch(emptyReportHtml, /Item totals for the period/)
    assert.doesNotMatch(emptyReportHtml, /Payments received by tender/)
    assert.doesNotMatch(emptyReportHtml, /Tax totals by type/)

    assertSaleError(
      await toSalesResultAsync(() =>
        canceledExporter.exportPdf({ type: 'day', date: '2025-03-09' }, ['overview', 'bad'])
      ),
      'invalid-input'
    )
    assertSaleError(
      await toSalesResultAsync(() =>
        canceledExporter.exportPdf({ type: 'day', date: '2025-03-09' }, [], 'unknown')
      ),
      'invalid-input'
    )

    const failedExporter = createSalesExportService(
      service,
      async () => true,
      async () => {
        throw new Error('PDF generation failed')
      }
    )
    assertSaleError(
      await toSalesResultAsync(() =>
        failedExporter.exportPdf({ type: 'day', date: '2025-03-09' }, ['overview'])
      ),
      'export-failed'
    )
  })
})

test('CSV quotes fields containing commas, quotes, and line breaks', () => {
  const csv = serializeSalesCsv([
    {
      id: 7,
      transactionNumber: '20250309-0007',
      transactionType: 'sale',
      returnReason: null,
      subtotalCents: 100,
      taxCents: 0,
      totalCents: 100,
      paymentMethod: 'cash',
      chargeAmountCents: null,
      chargeBalanceCents: null,
      payments: [
        { type: 'cash', amountTenderedCents: 100, amountAppliedCents: 100, changeCents: 0 }
      ],
      createdAt: 'invalid date, "detail"\ncontinued',
      itemCount: 1,
      customer: null
    }
  ])

  assert.ok(
    csv.endsWith(
      'sale,Invoice #20250309-0007,"invalid date, ""detail""\ncontinued",cash,"Cash: tendered 1.00, applied 1.00, change 0.00",,1,1.00,0.00,1.00'
    )
  )
})

test('completed sale and item snapshots persist after reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pos-sales-'))
  const path = join(directory, 'sales.sqlite')
  let database = new Database(path)
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const productId = createProduct(products, {
    sku: 'PERSIST',
    name: 'Persistent item',
    priceCents: 499,
    stockQuantity: 3
  })
  const sales = createSalesService(createSalesRepository(database))
  const sale = completeWithPayment(sales, [{ productId, quantity: 1 }])
  database.close()

  try {
    database = new Database(path)
    const reopened = createSalesService(createSalesRepository(database))
    const persisted = reopened.getById(sale.sale.id)
    assert.equal(persisted.transactionNumber, sale.sale.transactionNumber)
    assert.equal(persisted.totalCents, 499)
    assert.equal(persisted.items[0]?.name, 'Persistent item')
    assert.equal(persisted.items[0]?.unitPriceCents, 499)
    assert.equal(persisted.payments[0]?.amountAppliedCents, 499)
  } finally {
    if (database.open) database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migration backfills historical payment types and original item prices', () => {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(
    readFileSync(
      join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
      'utf8'
    ) +
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/002_multiple_tax_rates.sql'),
        'utf8'
      )
  )
  try {
    const cashSale = Number(
      database
        .prepare(
          `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
           VALUES (200, 0, 200, 'cash')`
        )
        .run().lastInsertRowid
    )
    const cardSale = Number(
      database
        .prepare(
          `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
           VALUES (300, 0, 300, 'card')`
        )
        .run().lastInsertRowid
    )
    const zeroSale = Number(
      database
        .prepare(
          `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
           VALUES (0, 0, 0, 'cash')`
        )
        .run().lastInsertRowid
    )
    database
      .prepare(
        `INSERT INTO sale_items
           (sale_id, product_id, sku, product_name, unit_price_cents, quantity, line_total_cents)
         VALUES (?, NULL, 'OLD', 'Old item', 200, 1, 200)`
      )
      .run(cashSale)
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/003_tenders_and_price_overrides.sql'),
        'utf8'
      )
    )

    const payments = database
      .prepare(
        'SELECT sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents FROM sale_payments ORDER BY sale_id'
      )
      .all()
    assert.deepEqual(payments, [
      {
        sale_id: cashSale,
        payment_type: 'cash',
        amount_tendered_cents: null,
        amount_applied_cents: 200,
        change_cents: 0
      },
      {
        sale_id: cardSale,
        payment_type: 'card',
        amount_tendered_cents: 300,
        amount_applied_cents: 300,
        change_cents: 0
      },
      {
        sale_id: zeroSale,
        payment_type: 'cash',
        amount_tendered_cents: null,
        amount_applied_cents: 0,
        change_cents: 0
      }
    ])
    assert.equal(
      (
        database
          .prepare('SELECT original_unit_price_cents FROM sale_items WHERE sale_id = ?')
          .get(cashSale) as { original_unit_price_cents: number }
      ).original_unit_price_cents,
      200
    )
    const legacyBrandSale = Number(
      database
        .prepare(
          `INSERT INTO sales (subtotal_cents, tax_cents, total_cents, payment_method)
           VALUES (300, 0, 300, 'card')`
        )
        .run().lastInsertRowid
    )
    database
      .prepare(
        `INSERT INTO sale_payments
           (sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(legacyBrandSale, 'mastercard', 100, 100)
    database
      .prepare(
        `INSERT INTO sale_payments
           (sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents)
         VALUES (?, ?, ?, ?, 0)`
      )
      .run(legacyBrandSale, 'visa', 200, 200)
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/004_credit_tender_type.sql'),
        'utf8'
      )
    )
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/005_business_email.sql'),
        'utf8'
      )
    )
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/006_receipt_business_details.sql'),
        'utf8'
      )
    )
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/007_standalone_returns.sql'),
        'utf8'
      )
    )
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/008_transaction_numbers.sql'),
        'utf8'
      )
    )
    backfillTransactionNumbers(database)
    database.exec(
      readFileSync(join(process.cwd(), 'src/main/database/migrations/009_sale_charges.sql'), 'utf8')
    )
    const existingChargeSaleId = Number(
      database
        .prepare(
          `INSERT INTO sales
             (subtotal_cents, tax_cents, total_cents, payment_method, transaction_number)
           VALUES (500, 0, 500, 'cash', '20990101-0002')`
        )
        .run().lastInsertRowid
    )
    const existingChargeId = Number(
      database
        .prepare(
          `INSERT INTO sale_charges (sale_id, customer_name, amount_cents)
           VALUES (?, 'Legacy Customer', 500)`
        )
        .run(existingChargeSaleId).lastInsertRowid
    )
    database
      .prepare(
        `INSERT INTO charge_payments (charge_id, payment_type, amount_cents, created_at)
         VALUES (?, 'cash', 100, '2025-01-01 12:00:00')`
      )
      .run(existingChargeId)
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/010_charge_payment_tenders.sql'),
        'utf8'
      )
    )
    database.exec(
      readFileSync(join(process.cwd(), 'src/main/database/migrations/011_customers.sql'), 'utf8')
    )
    database.exec(
      readFileSync(
        join(process.cwd(), 'src/main/database/migrations/012_transaction_customers.sql'),
        'utf8'
      )
    )
    const historicalSales = createSalesService(createSalesRepository(database))
    assert.equal(historicalSales.getById(zeroSale).paymentMethod, 'cash')
    assert.equal(historicalSales.getById(zeroSale).customer, null)
    const migratedSales = createSalesService(createSalesRepository(database))
    assert.equal(migratedSales.getById(cardSale).payments[0]?.type, 'card')
    assert.deepEqual(
      migratedSales.getById(legacyBrandSale).payments.map(({ type }) => type),
      ['mastercard', 'visa']
    )
    assert.deepEqual(
      migratedSales
        .getById(existingChargeSaleId)
        .charge?.payments.map(({ type, amountCents }) => [type, amountCents]),
      [['cash', 100]]
    )
    assert.equal(
      migratedSales.getById(existingChargeSaleId).charge?.customer.name,
      'Legacy Customer'
    )
    assert.equal(migratedSales.getById(existingChargeSaleId).customer, null)
    migratedSales.recordChargePayment({
      saleId: existingChargeSaleId,
      type: 'etransfer',
      amountCents: 150
    })
    migratedSales.recordChargePayment({
      saleId: existingChargeSaleId,
      type: 'check',
      amountCents: 250
    })
    assert.deepEqual(
      migratedSales.getById(existingChargeSaleId).charge?.payments.map(({ type }) => type),
      ['cash', 'etransfer', 'check']
    )
    assert.deepEqual(database.pragma('foreign_key_check'), [])

    const creditSale = Number(
      database
        .prepare(
          `INSERT INTO sales
             (subtotal_cents, tax_cents, total_cents, payment_method, transaction_number)
           VALUES (400, 0, 400, 'card', '20990101-0001')`
        )
        .run().lastInsertRowid
    )
    database
      .prepare(
        `INSERT INTO sale_payments
           (sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents)
         VALUES (?, 'credit', 400, 400, 0)`
      )
      .run(creditSale)
    assert.equal(migratedSales.getById(creditSale).payments[0]?.type, 'credit')
  } finally {
    database.close()
  }
})

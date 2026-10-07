import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createProductRepository } from '../src/main/database/repositories/products'
import { createSalesRepository } from '../src/main/database/repositories/sales'
import { createSettingsRepository } from '../src/main/database/repositories/settings'
import { createSalesService, toSalesResult } from '../src/main/sales-service'

const schema = readFileSync(
  join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
  'utf8'
)

function withSales(
  run: (context: {
    database: Database.Database
    products: ReturnType<typeof createProductRepository>
    settings: ReturnType<typeof createSettingsRepository>
    service: ReturnType<typeof createSalesService>
  }) => void
): void {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const settings = createSettingsRepository(database)
  const service = createSalesService(createSalesRepository(database), settings)

  try {
    run({ database, products, settings, service })
  } finally {
    database.close()
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

function assertSaleError<T>(
  result: ReturnType<typeof toSalesResult<T>>,
  code: string
): asserts result is { ok: false; error: { code: string; message: string } } {
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, code)
}

test('quotes current prices and rounds tax once across the sale subtotal', () => {
  withSales(({ database, products, service }) => {
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
    database.prepare('UPDATE settings SET tax_rate_basis_points = 1000 WHERE id = 1').run()

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

    const sale = service.completeCheckout({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'cash'
    })
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

    service.completeCheckout({
      items: [
        { productId: trackedId, quantity: 2 },
        { productId: untrackedId, quantity: 100 }
      ],
      paymentMethod: 'card'
    })

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
        service.completeCheckout({ items: [{ productId, quantity: 0 }], paymentMethod: 'cash' })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({ items: [{ productId, quantity: 1 }], paymentMethod: 'cheque' })
      ),
      'invalid-input'
    )
    assertSaleError(
      toSalesResult(() => service.quote([{ productId: 999, quantity: 1 }])),
      'unavailable-product'
    )

    const insufficient = toSalesResult(() =>
      service.completeCheckout({ items: [{ productId, quantity: 2 }], paymentMethod: 'cash' })
    )
    assertSaleError(insufficient, 'insufficient-stock')

    products.setActive(productId, false)
    assertSaleError(
      toSalesResult(() =>
        service.completeCheckout({
          items: [{ productId, quantity: 1 }],
          paymentMethod: 'cash'
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
      () =>
        service.completeCheckout({ items: [{ productId, quantity: 2 }], paymentMethod: 'cash' }),
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
    const first = service.completeCheckout({
      items: [{ productId, quantity: 1 }],
      paymentMethod: 'cash'
    })
    const second = service.completeCheckout({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'card'
    })

    assert.deepEqual(
      service.listRecent().map(({ id, itemCount }) => [id, itemCount]),
      [
        [second.sale.id, 1],
        [first.sale.id, 1]
      ]
    )
  })
})

test('completed sale and item snapshots persist after reopening the database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pos-sales-'))
  const path = join(directory, 'sales.sqlite')
  let database = new Database(path)
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const settings = createSettingsRepository(database)
  const productId = createProduct(products, {
    sku: 'PERSIST',
    name: 'Persistent item',
    priceCents: 499,
    stockQuantity: 3
  })
  const sale = createSalesService(createSalesRepository(database), settings).completeCheckout({
    items: [{ productId, quantity: 1 }],
    paymentMethod: 'cash'
  })
  database.close()

  try {
    database = new Database(path)
    const reopened = createSalesService(
      createSalesRepository(database),
      createSettingsRepository(database)
    )
    const persisted = reopened.getById(sale.sale.id)
    assert.equal(persisted.totalCents, 499)
    assert.equal(persisted.items[0]?.name, 'Persistent item')
    assert.equal(persisted.items[0]?.unitPriceCents, 499)
  } finally {
    if (database.open) database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

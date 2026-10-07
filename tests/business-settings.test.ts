import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import {
  createBusinessSettingsService,
  toBusinessSettingsResult
} from '../src/main/business-settings-service'
import { createProductRepository } from '../src/main/database/repositories/products'
import { createSalesRepository } from '../src/main/database/repositories/sales'
import { createSettingsRepository } from '../src/main/database/repositories/settings'
import { createReceiptService } from '../src/main/receipt-service'
import { createSalesService } from '../src/main/sales-service'

const schema = readFileSync(
  join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
  'utf8'
)

test('reads defaults, trims business names, and converts percentages to basis points', () => {
  const database = createDatabase()
  try {
    const settingsRepository = createSettingsRepository(database)
    const service = createBusinessSettingsService(settingsRepository)

    assert.deepEqual(service.get(), { businessName: 'My Store', taxRateBasisPoints: 0 })
    assert.deepEqual(service.save({ businessName: '  Corner Shop  ', taxRatePercent: '12.5' }), {
      businessName: 'Corner Shop',
      taxRateBasisPoints: 1250
    })
    assert.equal(
      service.save({ businessName: 'Corner Shop', taxRatePercent: '0.01' }).taxRateBasisPoints,
      1
    )
    assert.equal(
      service.save({ businessName: 'Corner Shop', taxRatePercent: '100' }).taxRateBasisPoints,
      10_000
    )
  } finally {
    database.close()
  }
})

test('rejects blank business names and invalid or out-of-range tax rates', () => {
  const database = createDatabase()
  try {
    const service = createBusinessSettingsService(createSettingsRepository(database))
    const invalidInputs = [
      { businessName: '   ', taxRatePercent: '12.50', field: 'businessName' },
      { businessName: 'Corner Shop', taxRatePercent: '', field: 'taxRatePercent' },
      { businessName: 'Corner Shop', taxRatePercent: '-1', field: 'taxRatePercent' },
      { businessName: 'Corner Shop', taxRatePercent: '100.01', field: 'taxRatePercent' },
      { businessName: 'Corner Shop', taxRatePercent: '12.345', field: 'taxRatePercent' },
      { businessName: 'Corner Shop', taxRatePercent: 'one', field: 'taxRatePercent' }
    ]

    for (const input of invalidInputs) {
      const result = toBusinessSettingsResult(() => service.save(input))
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.error.code, 'invalid-input')
        assert.equal(result.error.field, input.field)
      }
    }
    assert.deepEqual(service.get(), { businessName: 'My Store', taxRateBasisPoints: 0 })
  } finally {
    database.close()
  }
})

test('business settings persist after reopening the existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pos-business-settings-'))
  const path = join(directory, 'settings.sqlite')
  let database = new Database(path)
  database.exec(schema)
  createBusinessSettingsService(createSettingsRepository(database)).save({
    businessName: 'Harbour Market',
    taxRatePercent: '7.25'
  })
  database.close()

  try {
    database = new Database(path)
    assert.deepEqual(createBusinessSettingsService(createSettingsRepository(database)).get(), {
      businessName: 'Harbour Market',
      taxRateBasisPoints: 725
    })
  } finally {
    if (database.open) database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('updated tax affects the next quote while saved sale and receipt snapshots remain historical', async () => {
  const database = createDatabase()
  try {
    const products = createProductRepository(database)
    const salesRepository = createSalesRepository(database)
    const settingsRepository = createSettingsRepository(database)
    const settingsService = createBusinessSettingsService(settingsRepository)
    const sales = createSalesService(salesRepository, settingsRepository)
    const product = products.create({
      sku: 'TEA',
      name: 'Breakfast tea',
      priceCents: 200,
      stockQuantity: null
    })
    settingsService.save({ businessName: 'First Shop', taxRatePercent: '12.50' })

    const firstQuote = sales.quote([{ productId: product.id, quantity: 1 }])
    const completed = sales.completeCheckout({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'cash'
    })
    assert.equal(firstQuote.taxCents, 25)
    assert.equal(completed.sale.taxCents, 25)
    assert.equal(completed.sale.totalCents, 225)

    settingsService.save({ businessName: 'Second Shop', taxRatePercent: '0' })
    const nextQuote = sales.quote([{ productId: product.id, quantity: 1 }])
    assert.equal(nextQuote.taxCents, 0)
    assert.equal(nextQuote.totalCents, 200)
    const secondCompleted = sales.completeCheckout({
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'card'
    })
    assert.equal(secondCompleted.sale.taxCents, 0)
    assert.equal(secondCompleted.sale.totalCents, 200)

    let printedHtml = ''
    const receipts = createReceiptService({
      sales: salesRepository,
      settings: settingsRepository,
      listSystemPrinters: async () => [
        { name: 'Receipt_Printer', displayName: 'Receipt Printer', description: '' }
      ],
      printHtml: async (html) => {
        printedHtml = html
      }
    })
    await receipts.saveSettings({ printerName: 'Receipt_Printer', autoPrintReceipt: false })
    await receipts.print(completed.sale.id)

    const historical = sales.getById(completed.sale.id)
    assert.equal(historical.taxCents, 25)
    assert.equal(historical.items[0]?.name, 'Breakfast tea')
    assert.match(printedHtml, /Second Shop/)
    assert.match(printedHtml, /Breakfast tea/)
    assert.match(printedHtml, /\$0\.25/)
    assert.match(printedHtml, /\$2\.25/)
  } finally {
    database.close()
  }
})

function createDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  return database
}

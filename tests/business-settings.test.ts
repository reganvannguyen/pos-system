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
import { createTaxRepository } from '../src/main/database/repositories/taxes'
import { createReceiptService } from '../src/main/receipt-service'
import { createSalesService } from '../src/main/sales-service'
import { createTaxSettingsService, toTaxSettingsResult } from '../src/main/tax-settings-service'

const schema =
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
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/007_standalone_returns.sql'),
    'utf8'
  ) +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/008_transaction_numbers.sql'),
    'utf8'
  ) +
  readFileSync(join(process.cwd(), 'src/main/database/migrations/009_sale_charges.sql'), 'utf8') +
  readFileSync(
    join(process.cwd(), 'src/main/database/migrations/010_charge_payment_tenders.sql'),
    'utf8'
  )

test('reads defaults and trims business names', () => {
  const database = createDatabase()
  try {
    const settingsRepository = createSettingsRepository(database)
    const service = createBusinessSettingsService(settingsRepository)

    assert.deepEqual(service.get(), emptyBusinessSettings('My Store'))
    assert.deepEqual(
      service.save({ businessName: '  Corner Shop  ', businessEmail: '  shop@example.com  ' }),
      {
        ...emptyBusinessSettings('Corner Shop'),
        businessEmail: 'shop@example.com'
      }
    )
  } finally {
    database.close()
  }
})

test('rejects blank business names and invalid or out-of-range tax rates', () => {
  const database = createDatabase()
  try {
    const service = createBusinessSettingsService(createSettingsRepository(database))
    const blankBusiness = toBusinessSettingsResult(() => service.save({ businessName: '   ' }))
    assert.equal(blankBusiness.ok, false)
    if (!blankBusiness.ok) assert.equal(blankBusiness.error.field, 'businessName')

    const taxService = createTaxSettingsService(createTaxRepository(database))
    const invalidInputs = [
      { name: '', ratePercent: '12.50', field: 'name' },
      { name: 'GST', ratePercent: '', field: 'ratePercent' },
      { name: 'GST', ratePercent: '-1', field: 'ratePercent' },
      { name: 'GST', ratePercent: '100.01', field: 'ratePercent' },
      { name: 'GST', ratePercent: '12.345', field: 'ratePercent' },
      { name: 'GST', ratePercent: 'one', field: 'ratePercent' }
    ]
    for (const tax of invalidInputs) {
      const result = toTaxSettingsResult(() => taxService.save({ taxes: [tax] }))
      assert.equal(result.ok, false)
      if (!result.ok) {
        assert.equal(result.error.code, 'invalid-input')
        assert.equal(result.error.field, tax.field)
      }
    }
    const invalidEmail = toBusinessSettingsResult(() =>
      service.save({ businessName: 'My Store', businessEmail: 'bad address' })
    )
    assert.equal(invalidEmail.ok, false)
    if (!invalidEmail.ok) assert.equal(invalidEmail.error.field, 'businessEmail')
    const invalidWebsiteType = toBusinessSettingsResult(() =>
      service.save({ businessName: 'My Store', businessWebsite: 42 })
    )
    assert.equal(invalidWebsiteType.ok, false)
    if (!invalidWebsiteType.ok) assert.equal(invalidWebsiteType.error.field, 'businessWebsite')
    assert.deepEqual(service.get(), emptyBusinessSettings('My Store'))
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
    ...emptyBusinessSettings('Harbour Market'),
    businessEmail: 'hello@harbour.example',
    businessAddress: '  496 Stetson Street  ',
    businessCity: ' Kelowna ',
    businessProvince: ' BC ',
    businessPostalCode: ' V1X 8A5 ',
    businessPhone: ' (250) 712-9958 ',
    businessGstNumber: ' 123456789RT0001 ',
    businessWebsite: ' harbour.example '
  })
  createTaxSettingsService(createTaxRepository(database)).save({
    taxes: [{ name: 'PST', ratePercent: '7.25' }]
  })
  database.close()

  try {
    database = new Database(path)
    assert.deepEqual(createBusinessSettingsService(createSettingsRepository(database)).get(), {
      businessName: 'Harbour Market',
      businessAddress: '496 Stetson Street',
      businessCity: 'Kelowna',
      businessProvince: 'BC',
      businessPostalCode: 'V1X 8A5',
      businessPhone: '(250) 712-9958',
      businessEmail: 'hello@harbour.example',
      businessGstNumber: '123456789RT0001',
      businessWebsite: 'harbour.example'
    })
    assert.deepEqual(createTaxSettingsService(createTaxRepository(database)).get(), [
      { id: 1, name: 'PST', rateBasisPoints: 725 }
    ])
  } finally {
    if (database.open) database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('migration 005 adds the optional business email while preserving existing settings', () => {
  const migration = readFileSync(
    join(process.cwd(), 'src/main/database/migrations/005_business_email.sql'),
    'utf8'
  )
  const schemaBeforeBusinessEmail = schema.replace(migration, '')
  const database = new Database(':memory:')
  try {
    database.exec(schemaBeforeBusinessEmail)
    database.pragma('user_version = 4')
    database.prepare('UPDATE settings SET business_name = ? WHERE id = 1').run('Old Store')
    database.exec(migration)

    const settings = createSettingsRepository(database).get()
    assert.equal(settings.business_name, 'Old Store')
    assert.equal(settings.business_email, '')
  } finally {
    database.close()
  }
})

test('migration 006 adds optional receipt identity fields without changing store name', () => {
  const migration = readFileSync(
    join(process.cwd(), 'src/main/database/migrations/006_receipt_business_details.sql'),
    'utf8'
  )
  const schemaBeforeReceiptDetails = schema.replace(migration, '')
  const database = new Database(':memory:')
  try {
    database.exec(schemaBeforeReceiptDetails)
    database.pragma('user_version = 5')
    database.prepare('UPDATE settings SET business_name = ? WHERE id = 1').run('Old Store')
    database.exec(migration)

    const settings = createSettingsRepository(database).get()
    assert.equal(settings.business_name, 'Old Store')
    assert.equal(settings.business_address, '')
    assert.equal(settings.business_gst_number, '')
    assert.equal(settings.business_website, '')
  } finally {
    database.close()
  }
})

test('updated tax affects the next quote while saved sale and receipt snapshots remain historical', async () => {
  const database = createDatabase()
  try {
    const products = createProductRepository(database)
    const taxRepository = createTaxRepository(database)
    const salesRepository = createSalesRepository(database, taxRepository)
    const settingsRepository = createSettingsRepository(database)
    const settingsService = createBusinessSettingsService(settingsRepository)
    const taxService = createTaxSettingsService(taxRepository)
    const sales = createSalesService(salesRepository)
    const product = products.create({
      sku: 'TEA',
      name: 'Breakfast tea',
      priceCents: 200,
      stockQuantity: null
    })
    settingsService.save({
      ...emptyBusinessSettings('First Shop'),
      businessEmail: 'first@example.com'
    })
    taxService.save({ taxes: [{ name: 'GST', ratePercent: '12.50' }] })

    const firstQuote = sales.quote([{ productId: product.id, quantity: 1 }])
    const completed = sales.completeCheckout({
      items: [{ productId: product.id, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: firstQuote.totalCents }]
    })
    assert.equal(firstQuote.taxCents, 25)
    assert.equal(completed.sale.taxCents, 25)
    assert.equal(completed.sale.totalCents, 225)

    settingsService.save({
      ...emptyBusinessSettings('Second Shop'),
      businessAddress: '99 New Street',
      businessCity: 'Kelowna',
      businessProvince: 'BC',
      businessEmail: 'second@example.com'
    })
    taxService.save({ taxes: [] })
    const nextQuote = sales.quote([{ productId: product.id, quantity: 1 }])
    assert.equal(nextQuote.taxCents, 0)
    assert.equal(nextQuote.totalCents, 200)
    const secondCompleted = sales.completeCheckout({
      items: [{ productId: product.id, quantity: 1 }],
      tenders: [{ type: 'credit', amountCents: nextQuote.totalCents }]
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
      },
      createPdf: async (_html, saleId) => `/tmp/receipt-${saleId}.pdf`,
      deletePdf: async () => {},
      openEmailDraft: async () => false,
      openExternal: async () => {},
      showItemInFolder: () => {}
    })
    await receipts.saveSettings({ printerName: 'Receipt_Printer' })
    await receipts.print(completed.sale.id)

    const historical = sales.getById(completed.sale.id)
    assert.equal(historical.taxCents, 25)
    assert.equal(historical.items[0]?.name, 'Breakfast tea')
    assert.match(printedHtml, /Second Shop/)
    assert.match(printedHtml, /second@example.com/)
    assert.match(printedHtml, /99 New Street/)
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

function emptyBusinessSettings(businessName: string) {
  return {
    businessName,
    businessAddress: '',
    businessCity: '',
    businessProvince: '',
    businessPostalCode: '',
    businessPhone: '',
    businessEmail: '',
    businessGstNumber: '',
    businessWebsite: ''
  }
}

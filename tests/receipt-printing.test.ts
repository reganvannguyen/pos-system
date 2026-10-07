import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createProductRepository } from '../src/main/database/repositories/products'
import { createSalesRepository } from '../src/main/database/repositories/sales'
import { createSettingsRepository } from '../src/main/database/repositories/settings'
import { createReceiptService, toPrinterOption, toReceiptResult } from '../src/main/receipt-service'
import { createSalesService } from '../src/main/sales-service'

const schema = readFileSync(
  join(process.cwd(), 'src/main/database/migrations/001_initial_schema.sql'),
  'utf8'
)

async function withReceiptService(
  run: (context: {
    database: Database.Database
    products: ReturnType<typeof createProductRepository>
    sales: ReturnType<typeof createSalesRepository>
    settings: ReturnType<typeof createSettingsRepository>
    receipt: ReturnType<typeof createReceiptService>
    setPrinters: (printers: { name: string; displayName: string; description: string }[]) => void
    printJobs: string[]
  }) => Promise<void>
): Promise<void> {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const sales = createSalesRepository(database)
  const settings = createSettingsRepository(database)
  let printers = [
    { name: 'Receipt_Printer', displayName: 'Receipt Printer', description: '80 mm USB' }
  ]
  const printJobs: string[] = []
  const receipt = createReceiptService({
    sales,
    settings,
    listSystemPrinters: async () => printers,
    printHtml: async (html) => {
      printJobs.push(html)
    }
  })

  try {
    await run({
      database,
      products,
      sales,
      settings,
      receipt,
      setPrinters: (next) => {
        printers = next
      },
      printJobs
    })
  } finally {
    database.close()
  }
}

function createProduct(
  products: ReturnType<typeof createProductRepository>,
  values: { sku: string; name: string; priceCents: number; stockQuantity?: number | null }
): number {
  return products.create({
    sku: values.sku,
    name: values.name,
    priceCents: values.priceCents,
    stockQuantity: values.stockQuantity ?? null
  }).id
}

function assertReceiptError<T>(
  result: Awaited<ReturnType<typeof toReceiptResult<T>>>,
  code: string
): asserts result is { ok: false; error: { code: string; message: string } } {
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, code)
}

test('maps operating-system printer names separately from friendly names', () => {
  assert.deepEqual(
    toPrinterOption({ name: 'EPSON_TM_T20', displayName: 'EPSON TM-T20', description: '' }),
    { name: 'EPSON_TM_T20', displayName: 'EPSON TM-T20', description: '' }
  )
  assert.deepEqual(
    toPrinterOption({ name: 'Office_Printer', displayName: '', description: 'Network printer' }),
    { name: 'Office_Printer', displayName: 'Office_Printer', description: 'Network printer' }
  )
})

test('lists printers by friendly name and stores the operating-system name', async () => {
  await withReceiptService(async ({ products, receipt, sales, settings, setPrinters }) => {
    setPrinters([
      { name: 'ZEBRA_2', displayName: 'Zebra', description: '' },
      { name: 'EPSON_1', displayName: 'Epson Receipt', description: 'USB' }
    ])
    assert.deepEqual(
      (await receipt.listPrinters()).map(({ name, displayName }) => [name, displayName]),
      [
        ['EPSON_1', 'Epson Receipt'],
        ['ZEBRA_2', 'Zebra']
      ]
    )
    assert.deepEqual(receipt.getSettings(), { printerName: null, autoPrintReceipt: false })
    assert.deepEqual(
      await receipt.saveSettings({ printerName: 'EPSON_1', autoPrintReceipt: true }),
      {
        printerName: 'EPSON_1',
        autoPrintReceipt: true
      }
    )
    assert.equal(settings.get().printer_name, 'EPSON_1')
    assert.equal(settings.get().auto_print_receipt, 1)
    const productId = createProduct(products, {
      sku: 'AUTO-PRINT',
      name: 'Auto print item',
      priceCents: 100
    })
    assert.equal(
      createSalesService(sales, settings).completeCheckout({
        items: [{ productId, quantity: 1 }],
        paymentMethod: 'cash'
      }).autoPrintReceipt,
      true
    )
  })
})

test('requires a selected, available printer for automatic printing', async () => {
  await withReceiptService(async ({ receipt, setPrinters }) => {
    assertReceiptError(
      await toReceiptResult(() =>
        receipt.saveSettings({ printerName: null, autoPrintReceipt: true })
      ),
      'printer-not-selected'
    )
    assertReceiptError(
      await toReceiptResult(() =>
        receipt.saveSettings({ printerName: 'Missing_Printer', autoPrintReceipt: false })
      ),
      'printer-unavailable'
    )
    setPrinters([])
    assertReceiptError(
      await toReceiptResult(() =>
        receipt.saveSettings({ printerName: 'Receipt_Printer', autoPrintReceipt: true })
      ),
      'printer-unavailable'
    )
  })
})

test('escapes receipt content and uses saved sale snapshots', async () => {
  await withReceiptService(async ({ database, products, settings, sales, receipt, printJobs }) => {
    const productId = createProduct(products, {
      sku: '<script>SKU</script>',
      name: '<img src=x onerror=alert(1)>',
      priceCents: 275
    })
    const checkout = createSalesService(sales, settings).completeCheckout({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'cash'
    })
    products.update(productId, {
      sku: 'CHANGED',
      name: 'Changed after checkout',
      priceCents: 999,
      stockQuantity: null
    })
    database
      .prepare('UPDATE settings SET business_name = ? WHERE id = 1')
      .run('<script>Shop</script>')
    await receipt.saveSettings({ printerName: 'Receipt_Printer', autoPrintReceipt: false })
    const printed = await receipt.print(checkout.sale.id)

    assert.equal(printed.sentToPrinter, true)
    const html = printJobs[0]!
    assert.match(html, /&lt;script&gt;SKU&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img src=x/)
    assert.match(html, /&lt;script&gt;Shop&lt;\/script&gt;/)
    assert.match(html, /\$2\.75 each/)
    assert.match(html, /\$5\.50/)
    assert.doesNotMatch(html, /Changed after checkout/)
  })
})

test('print failure leaves the saved sale and decremented stock intact for reprinting', async () => {
  await withReceiptService(async ({ database, products, sales, settings, receipt, printJobs }) => {
    const productId = createProduct(products, {
      sku: 'STOCKED',
      name: 'Stocked item',
      priceCents: 500,
      stockQuantity: 4
    })
    const checkout = createSalesService(sales, settings).completeCheckout({
      items: [{ productId, quantity: 2 }],
      paymentMethod: 'card'
    })
    await receipt.saveSettings({ printerName: 'Receipt_Printer', autoPrintReceipt: false })
    let failPrint = true
    const printerService = createReceiptService({
      sales,
      settings,
      listSystemPrinters: async () => [
        { name: 'Receipt_Printer', displayName: 'Receipt Printer', description: '' }
      ],
      printHtml: async (html) => {
        if (failPrint) throw new Error('Printer offline')
        printJobs.push(html)
      }
    })

    assertReceiptError(
      await toReceiptResult(() => printerService.print(checkout.sale.id)),
      'print-failed'
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 1)
    assert.equal(
      database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId)
        ?.stock_quantity,
      2
    )

    failPrint = false
    assert.equal((await printerService.print(checkout.sale.id)).sentToPrinter, true)
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 1)
    assert.equal(printJobs.length, 1)
  })
})

test('rejects missing sales and missing or disconnected configured printers', async () => {
  await withReceiptService(async ({ receipt, setPrinters }) => {
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'printer-not-selected')
    await receipt.saveSettings({ printerName: 'Receipt_Printer', autoPrintReceipt: false })
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'sale-not-found')
    setPrinters([])
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'printer-unavailable')
  })
})

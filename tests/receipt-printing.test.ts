import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { createProductRepository } from '../src/main/database/repositories/products'
import { createSalesRepository } from '../src/main/database/repositories/sales'
import { createSettingsRepository } from '../src/main/database/repositories/settings'
import {
  buildMailtoUrl,
  buildTextUrl,
  createReceiptService,
  toPrinterOption,
  toReceiptResult
} from '../src/main/receipt-service'
import { renderReceiptHtml, renderReceiptPreviewHtml } from '../src/shared/receipt-html'
import { createSalesService } from '../src/main/sales-service'

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
  readFileSync(join(process.cwd(), 'src/main/database/migrations/009_sale_charges.sql'), 'utf8')

async function withReceiptService(
  run: (context: {
    database: Database.Database
    products: ReturnType<typeof createProductRepository>
    sales: ReturnType<typeof createSalesRepository>
    settings: ReturnType<typeof createSettingsRepository>
    receipt: ReturnType<typeof createReceiptService>
    setPrinters: (printers: { name: string; displayName: string; description: string }[]) => void
    printJobs: string[]
    externalUrls: string[]
    shownFiles: string[]
    pdfJobs: string[]
    setEmailAttachmentSupport: (supported: boolean) => void
    setExternalAppAvailable: (available: boolean) => void
  }) => Promise<void>
): Promise<void> {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  const products = createProductRepository(database)
  const sales = createSalesRepository(database)
  const settings = createSettingsRepository(database)
  let printers = [
    { name: 'Receipt_Printer', displayName: 'Receipt Printer', description: '58 mm USB' }
  ]
  const printJobs: string[] = []
  const externalUrls: string[] = []
  const shownFiles: string[] = []
  const pdfJobs: string[] = []
  let emailAttachmentSupported = false
  let externalAppAvailable = true
  const receipt = createReceiptService({
    sales,
    settings,
    listSystemPrinters: async () => printers,
    printHtml: async (html) => {
      printJobs.push(html)
    },
    createPdf: async (html, saleId) => {
      pdfJobs.push(html)
      return `/tmp/receipt-${saleId}.pdf`
    },
    deletePdf: async () => {},
    openEmailDraft: async () => emailAttachmentSupported,
    openExternal: async (url) => {
      if (!externalAppAvailable) throw new Error('No application is registered for this URI.')
      externalUrls.push(url)
    },
    showItemInFolder: (path) => shownFiles.push(path)
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
      printJobs,
      externalUrls,
      shownFiles,
      pdfJobs,
      setEmailAttachmentSupport: (supported) => {
        emailAttachmentSupported = supported
      },
      setExternalAppAvailable: (available) => {
        externalAppAvailable = available
      }
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

function businessSettings(businessName: string, businessEmail = '') {
  return {
    businessName,
    businessAddress: '',
    businessCity: '',
    businessProvince: '',
    businessPostalCode: '',
    businessPhone: '',
    businessEmail,
    businessGstNumber: '',
    businessWebsite: ''
  }
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

test('live receipt preview renders draft details in the shared 58 mm invoice template', () => {
  const html = renderReceiptPreviewHtml({
    ...businessSettings('Rainbow & Co'),
    businessAddress: '496 Stetson Street',
    businessCity: 'Kelowna',
    businessProvince: 'BC',
    businessPostalCode: 'V1X 8A5',
    businessPhone: '(250) 712-9958',
    businessGstNumber: '123456789RT0001',
    businessWebsite: 'rainbow.example'
  })
  assert.match(html, /width: 58mm/)
  assert.match(html, /Rainbow &amp; Co/)
  assert.match(html, /496 Stetson Street/)
  assert.match(html, /Kelowna, BC V1X 8A5/)
  assert.match(html, /INVOICE NO\. 20251008-0001/)
  assert.match(html, /DATE: \d{2}\/\d{2}\/\d{2}/)
  assert.match(html, /TIME: \d{1,2}:\d{2} (AM|PM)/)
  assert.match(html, /Description<\/th><th>Qty<\/th><th>Price<\/th><th>Total<\/th>/)
  assert.match(html, /GST \(5\.00%\)/)
  assert.match(html, /PST \(7\.00%\)/)
  assert.match(html, /Amount tendered/)
  assert.match(html, /Change due/)
  assert.match(html, /Payment type/)
  assert.match(html, /GST\/HST #123456789RT0001/)
  assert.match(html, /rainbow\.example/)
})

test('charged receipt prints escaped customer details and the current balance due', () => {
  const html = renderReceiptHtml(
    {
      transactionNumber: '20261010-0001',
      createdAt: '2026-10-10 12:00:00',
      items: [],
      subtotalCents: 1000,
      taxes: [],
      taxCents: 0,
      totalCents: 1000,
      payments: [],
      charge: {
        customer: {
          name: '<Alex Customer>',
          companyName: 'Example Co',
          address: '12 Main Street',
          phoneNumber: '604-555-0100',
          email: 'alex@example.com'
        },
        amountCents: 1000,
        balanceCents: 650
      }
    },
    businessSettings('Corner Shop')
  )

  assert.match(html, /CHARGED TO/)
  assert.match(html, /&lt;Alex Customer&gt;/)
  assert.match(html, /Example Co/)
  assert.match(html, /12 Main Street/)
  assert.match(html, /alex@example\.com/)
  assert.match(html, /Amount charged/)
  assert.match(html, /Balance due/)
  assert.match(html, /\$6\.50/)
  assert.match(html, /Charge/)
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
    assert.deepEqual(receipt.getSettings(), { printerName: null })
    assert.deepEqual(await receipt.saveSettings({ printerName: 'EPSON_1' }), {
      printerName: 'EPSON_1'
    })
    assert.equal(settings.get().printer_name, 'EPSON_1')
    const productId = createProduct(products, {
      sku: 'MANUAL-PRINT',
      name: 'Manual print item',
      priceCents: 100
    })
    const completion = createSalesService(sales).completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: 100 }]
    })
    assert.deepEqual(Object.keys(completion), ['sale'])
  })
})

test('requires a selected, available printer when printing', async () => {
  await withReceiptService(async ({ receipt, setPrinters }) => {
    await receipt.saveSettings({ printerName: null })
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'printer-not-selected')
    assertReceiptError(
      await toReceiptResult(() => receipt.saveSettings({ printerName: 'Missing_Printer' })),
      'printer-unavailable'
    )
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })
    setPrinters([])
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'printer-unavailable')
  })
})

test('escapes receipt content and uses saved sale snapshots', async () => {
  await withReceiptService(async ({ database, products, sales, receipt, printJobs }) => {
    const productId = createProduct(products, {
      sku: '<script>SKU</script>',
      name: '<img src=x onerror=alert(1)>',
      priceCents: 275
    })
    const checkout = createSalesService(sales).completeCheckout({
      items: [{ productId, quantity: 2 }],
      tenders: [{ type: 'cash', amountCents: 550 }]
    })
    products.update(productId, {
      sku: 'CHANGED',
      name: 'Changed after checkout',
      priceCents: 999,
      stockQuantity: null
    })
    database
      .prepare('UPDATE settings SET business_name = ?, business_email = ? WHERE id = 1')
      .run('<script>Shop</script>', '<img src=x@example.com>')
    database
      .prepare(
        `UPDATE settings
         SET business_address = ?, business_city = ?, business_province = ?,
             business_postal_code = ?, business_phone = ?, business_gst_number = ?, business_website = ?
         WHERE id = 1`
      )
      .run(
        '<img src=x>',
        'Test City',
        'BC',
        'V1X 8A5',
        '(250) 555-0100',
        '123456789RT0001',
        'example.test'
      )
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })
    const printed = await receipt.print(checkout.sale.id)

    assert.equal(printed.sentToPrinter, true)
    const html = printJobs[0]!
    assert.match(html, /&lt;script&gt;SKU&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
    assert.doesNotMatch(html, /<img src=x/)
    assert.match(html, /&lt;script&gt;Shop&lt;\/script&gt;/)
    assert.match(html, /&lt;img src=x@example.com&gt;/)
    assert.match(html, /&lt;img src=x&gt;/)
    assert.match(html, /Test City, BC V1X 8A5/)
    assert.match(html, /\(250\) 555-0100/)
    assert.match(html, /GST\/HST #123456789RT0001/)
    assert.match(html, /example\.test/)
    assert.match(html, /\$2\.75/)
    assert.match(html, /\$5\.50/)
    assert.match(html, /Amount tendered/)
    assert.match(html, new RegExp(`INVOICE NO\\. ${checkout.sale.transactionNumber}`))
    assert.match(html, /DATE: \d{2}\/\d{2}\/\d{2}/)
    assert.match(html, /TIME: \d{1,2}:\d{2} (AM|PM)/)
    assert.doesNotMatch(html, /Changed after checkout/)
  })
})

test('prints saved tender and change details without exposing the price override reason', async () => {
  await withReceiptService(async ({ products, sales, receipt, printJobs }) => {
    const productId = createProduct(products, {
      sku: 'MARKDOWN',
      name: 'Floor sample',
      priceCents: 500
    })
    const checkout = createSalesService(sales).completeCheckout({
      items: [
        {
          productId,
          quantity: 1,
          priceOverride: { unitPriceCents: 250, reason: 'Small mark on box' }
        }
      ],
      tenders: [{ type: 'cash', amountCents: 300 }]
    })
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })
    await receipt.print(checkout.sale.id)

    const html = printJobs[0]!
    assert.match(html, /\$2\.50/)
    assert.match(html, /Amount tendered/)
    assert.match(html, /\$3\.00/)
    assert.match(html, /\$0\.50/)
    assert.doesNotMatch(html, /Small mark on box/)
  })
})

test('return receipts use negative amounts, Return #, refund labels, and omit the internal reason', async () => {
  await withReceiptService(async ({ products, sales, receipt, printJobs }) => {
    const productId = createProduct(products, {
      sku: 'RETURN-RECEIPT',
      name: 'Returned item',
      priceCents: 700
    })
    const service = createSalesService(sales)
    const returned = service.completeReturn({
      reason: 'Internal reason: customer changed their mind',
      items: [{ productId, quantity: 1, restock: false }],
      tenders: [{ type: 'cash', amountCents: 700 }]
    })
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })

    await receipt.print(returned.return.id)
    const html = printJobs[0]!
    assert.match(html, new RegExp(`RETURN NO\\. ${returned.return.transactionNumber}`))
    assert.match(html, /-\$7\.00/)
    assert.match(html, /Amount refunded/)
    assert.match(html, /Refund method/)
    assert.doesNotMatch(html, /Change due/)
    assert.doesNotMatch(html, /Internal reason/)

    const email = await receipt.emailDraft(returned.return.id, 'customer@example.com')
    assert.match(email.subject, new RegExp(`Return #${returned.return.transactionNumber}`))
    assert.match(email.body, /Refunded -\$7\.00/)
    assert.doesNotMatch(email.body, /Internal reason/)
    const text = await receipt.textDraft(returned.return.id, '2505551234')
    assert.match(text.message, new RegExp(`Return #${returned.return.transactionNumber}`))
    assert.match(text.message, /Refunded -\$7\.00/)
    assert.doesNotMatch(text.message, /Internal reason/)
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
    const checkout = createSalesService(sales).completeCheckout({
      items: [{ productId, quantity: 2 }],
      tenders: [{ type: 'credit', amountCents: 1000 }]
    })
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })
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
      },
      createPdf: async (_html, saleId) => `/tmp/receipt-${saleId}.pdf`,
      deletePdf: async () => {},
      openEmailDraft: async () => false,
      openExternal: async () => {},
      showItemInFolder: () => {}
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
    await receipt.saveSettings({ printerName: 'Receipt_Printer' })
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'sale-not-found')
    setPrinters([])
    assertReceiptError(await toReceiptResult(() => receipt.print(1)), 'printer-unavailable')
  })
})

test('prepares email drafts with saved receipt PDF and supports manual attachment fallback', async () => {
  await withReceiptService(
    async ({
      database,
      products,
      settings,
      sales,
      receipt,
      externalUrls,
      shownFiles,
      pdfJobs,
      setExternalAppAvailable
    }) => {
      settings.saveBusiness(businessSettings('Harbour Market', 'hello@harbour.example'))
      const productId = createProduct(products, {
        sku: 'EMAIL-ITEM',
        name: 'Canned coffee',
        priceCents: 1000,
        stockQuantity: 3
      })
      const checkout = createSalesService(sales).completeCheckout({
        items: [
          { productId, quantity: 1, priceOverride: { unitPriceCents: 750, reason: 'Opened box' } }
        ],
        tenders: [{ type: 'cash', amountCents: 750 }]
      })

      const draft = await receipt.emailDraft(checkout.sale.id, ' customer@example.com ')
      assert.equal(draft.draftOpened, true)
      assert.equal(draft.attachmentIncluded, false)
      assert.match(draft.subject, /Invoice #/)
      assert.match(draft.body, /Harbour Market/)
      assert.match(externalUrls[0]!, /^mailto:customer%40example\.com\?subject=/)
      assert.match(pdfJobs[0]!, /hello@harbour\.example/)
      assert.match(pdfJobs[0]!, /Canned coffee/)
      assert.doesNotMatch(pdfJobs[0]!, /Opened box/)

      setExternalAppAvailable(false)
      const unavailableDraft = await receipt.emailDraft(checkout.sale.id, 'customer@example.com')
      assert.equal(unavailableDraft.draftOpened, false)
      assert.equal(unavailableDraft.attachmentIncluded, false)
      assert.match(unavailableDraft.body, /Harbour Market/)

      await receipt.openPdf(checkout.sale.id)
      assert.deepEqual(shownFiles, [`/tmp/receipt-${checkout.sale.id}.pdf`])
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sales').get()?.count, 1)
      assert.equal(
        database.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(productId)
          ?.stock_quantity,
        2
      )
      const saleColumns = database.prepare('PRAGMA table_info(sales)').all() as { name: string }[]
      assert.equal(
        saleColumns.some(({ name }) => /email|phone/i.test(name)),
        false
      )
    }
  )
})

test('uses the Windows mail adapter for PDF attachment when it is available', async () => {
  await withReceiptService(
    async ({ products, sales, receipt, externalUrls, pdfJobs, setEmailAttachmentSupport }) => {
      const productId = createProduct(products, { sku: 'MAPI', name: 'Tea', priceCents: 200 })
      const checkout = createSalesService(sales).completeCheckout({
        items: [{ productId, quantity: 1 }],
        tenders: [{ type: 'cash', amountCents: 200 }]
      })
      setEmailAttachmentSupport(true)

      const draft = await receipt.emailDraft(checkout.sale.id, 'customer@example.com')
      assert.equal(draft.draftOpened, true)
      assert.equal(draft.attachmentIncluded, true)
      assert.equal(pdfJobs.length, 1)
      assert.equal(externalUrls.length, 0)
    }
  )
})

test('prepares concise text drafts and exposes copy fallback when no messaging app opens', async () => {
  await withReceiptService(
    async ({ products, sales, settings, receipt, externalUrls, setExternalAppAvailable }) => {
      settings.saveBusiness(businessSettings('Corner Shop'))
      const productId = createProduct(products, { sku: 'SMS', name: 'Tea', priceCents: 299 })
      const checkout = createSalesService(sales).completeCheckout({
        items: [{ productId, quantity: 1 }],
        tenders: [{ type: 'cash', amountCents: 299 }]
      })
      setExternalAppAvailable(false)

      const draft = await receipt.textDraft(checkout.sale.id, '(604) 555-0123')
      assert.equal(draft.draftOpened, false)
      assert.match(draft.message, /Corner Shop/)
      assert.match(draft.message, /Invoice #/)
      assert.match(draft.message, /\$2\.99/)
      assert.equal(externalUrls.length, 0)
      assertReceiptError(
        await toReceiptResult(() => receipt.textDraft(checkout.sale.id, 'bad')),
        'invalid-input'
      )

      const windowsUrl = buildTextUrl(
        '+16045550123',
        'Corner Shop · Invoice #20261007-0001 · $2.99',
        'win32'
      )
      assert.match(windowsUrl, /^ms-chat:\?Addresses=/)
      const params = new URLSearchParams(windowsUrl.split('?')[1])
      assert.equal(params.get('Addresses'), '+16045550123')
      assert.equal(params.get('Body'), 'Corner Shop · Invoice #20261007-0001 · $2.99')
      assert.match(buildMailtoUrl('customer@example.com', 'Receipt', 'Sale'), /^mailto:/)
    }
  )
})

test('rejects invalid email recipients without opening external apps', async () => {
  await withReceiptService(async ({ products, sales, receipt, externalUrls }) => {
    const productId = createProduct(products, { sku: 'BAD-EMAIL', name: 'Tea', priceCents: 200 })
    const checkout = createSalesService(sales).completeCheckout({
      items: [{ productId, quantity: 1 }],
      tenders: [{ type: 'cash', amountCents: 200 }]
    })
    assertReceiptError(
      await toReceiptResult(() => receipt.emailDraft(checkout.sale.id, 'not-an-email')),
      'invalid-input'
    )
    assert.equal(externalUrls.length, 0)
  })
})

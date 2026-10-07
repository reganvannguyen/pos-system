import type {
  PrinterOption,
  ReceiptApiError,
  ReceiptErrorCode,
  ReceiptPrintResult,
  ReceiptResult,
  ReceiptSettings
} from '../shared/pos-api'
import type { SalesRepository } from './database/repositories/sales'
import type { SettingsRepository } from './database/repositories/settings'
import type { SaleDetailRecord } from './database/repositories/sales'

export interface SystemPrinter {
  name: string
  displayName: string
  description: string
}

interface ReceiptServiceDependencies {
  sales: SalesRepository
  settings: SettingsRepository
  listSystemPrinters: () => Promise<SystemPrinter[]>
  printHtml: (html: string, printerName: string) => Promise<void>
}

export class ReceiptServiceError extends Error {
  constructor(
    readonly code: Exclude<ReceiptErrorCode, 'internal'>,
    message: string
  ) {
    super(message)
    this.name = 'ReceiptServiceError'
  }
}

export function createReceiptService({
  sales,
  settings,
  listSystemPrinters,
  printHtml
}: ReceiptServiceDependencies) {
  return {
    async listPrinters(): Promise<PrinterOption[]> {
      return (await listSystemPrinters())
        .filter((printer) => typeof printer.name === 'string' && printer.name.length > 0)
        .map(toPrinterOption)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
    },

    getSettings(): ReceiptSettings {
      const value = settings.get()
      return {
        printerName: value.printer_name,
        autoPrintReceipt: value.auto_print_receipt === 1
      }
    },

    async saveSettings(value: unknown): Promise<ReceiptSettings> {
      const parsed = parseReceiptSettings(value)
      if (parsed.autoPrintReceipt && !parsed.printerName) {
        throw new ReceiptServiceError(
          'printer-not-selected',
          'Select a receipt printer before turning on automatic printing.'
        )
      }

      if (parsed.printerName) {
        await ensurePrinterAvailable(parsed.printerName)
      }

      const saved = settings.saveReceipt(parsed.printerName, parsed.autoPrintReceipt)
      return {
        printerName: saved.printer_name,
        autoPrintReceipt: saved.auto_print_receipt === 1
      }
    },

    async print(saleIdValue: unknown): Promise<ReceiptPrintResult> {
      const saleId = parseSaleId(saleIdValue)
      const currentSettings = settings.get()
      const printerName = currentSettings.printer_name
      if (!printerName) {
        throw new ReceiptServiceError(
          'printer-not-selected',
          'Choose a receipt printer in Settings before printing.'
        )
      }

      await ensurePrinterAvailable(printerName)
      const sale = sales.getById(saleId)
      if (!sale) {
        throw new ReceiptServiceError('sale-not-found', 'This sale could not be found.')
      }

      const html = renderReceiptHtml(sale, currentSettings.business_name)
      try {
        await printHtml(html, printerName)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'The printer rejected the job.'
        throw new ReceiptServiceError(
          'print-failed',
          `Receipt could not be sent to the printer. The sale is saved and can be reprinted. ${reason}`
        )
      }

      return { saleId, sentToPrinter: true }
    }
  }

  async function ensurePrinterAvailable(name: string): Promise<void> {
    const printers = await listSystemPrinters()
    if (!printers.some((printer) => printer.name === name)) {
      throw new ReceiptServiceError(
        'printer-unavailable',
        'The selected receipt printer is unavailable. Check its connection or choose another printer in Settings.'
      )
    }
  }
}

export type ReceiptService = ReturnType<typeof createReceiptService>

export async function toReceiptResult<T>(
  operation: () => Promise<T> | T
): Promise<ReceiptResult<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    if (error instanceof ReceiptServiceError) {
      return { ok: false, error: { code: error.code, message: error.message } }
    }

    console.error('Receipt operation failed.', error)
    const apiError: ReceiptApiError = {
      code: 'internal',
      message: 'Unable to complete the receipt operation.'
    }
    return { ok: false, error: apiError }
  }
}

export function toPrinterOption(printer: SystemPrinter): PrinterOption {
  return {
    name: printer.name,
    displayName: printer.displayName || printer.name,
    description: printer.description || ''
  }
}

export function renderReceiptHtml(sale: SaleDetailRecord, businessName: string): string {
  const esc = escapeHtml
  const items = sale.items
    .map(
      (item) => `<tr>
        <td class="item-name">${esc(item.product_name)}<small>${esc(item.sku)}</small><small>${formatMoney(item.unit_price_cents)} each</small></td>
        <td class="item-quantity">${item.quantity}</td>
        <td class="item-total">${formatMoney(item.line_total_cents)}</td>
      </tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Receipt #${sale.id}</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { width: 80mm; margin: 0; padding: 4mm; color: #111; font: 12px/1.35 Arial, sans-serif; }
    header { text-align: center; margin-bottom: 12px; }
    h1 { margin: 0 0 5px; font-size: 18px; overflow-wrap: anywhere; }
    p { margin: 2px 0; }
    .muted { color: #444; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 6px 0; border-top: 1px dashed #777; border-bottom: 1px dashed #777; text-align: left; font-size: 10px; }
    td { padding: 7px 0; vertical-align: top; }
    .item-name { width: 58%; overflow-wrap: anywhere; }
    .item-name small { display: block; color: #444; font-size: 10px; }
    .item-quantity { width: 12%; text-align: center; }
    .item-total { width: 30%; text-align: right; white-space: nowrap; }
    .totals { margin-top: 8px; padding-top: 7px; border-top: 1px dashed #777; }
    .totals div { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; }
    .total { margin-top: 4px; padding-top: 6px !important; border-top: 1px solid #111; font-size: 15px; font-weight: 700; }
    footer { margin-top: 13px; padding-top: 8px; border-top: 1px dashed #777; text-align: center; }
  </style>
</head>
<body>
  <header>
    <h1>${esc(businessName)}</h1>
    <p>Sale #${sale.id}</p>
    <p class="muted">${esc(sale.created_at)}</p>
  </header>
  <table aria-label="Purchased items">
    <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>${items}</tbody>
  </table>
  <section class="totals" aria-label="Sale totals">
    <div><span>Subtotal</span><span>${formatMoney(sale.subtotal_cents)}</span></div>
    <div><span>Tax</span><span>${formatMoney(sale.tax_cents)}</span></div>
    <div class="total"><span>Total</span><span>${formatMoney(sale.total_cents)}</span></div>
    <div><span>Payment</span><span>${esc(sale.payment_method.toUpperCase())}</span></div>
  </section>
  <footer><p>Thank you for your purchase</p></footer>
</body>
</html>`
}

function parseReceiptSettings(value: unknown): ReceiptSettings {
  if (!isRecord(value)) {
    throw new ReceiptServiceError('invalid-input', 'Enter valid receipt settings.')
  }
  if (value.printerName !== null && typeof value.printerName !== 'string') {
    throw new ReceiptServiceError('invalid-input', 'Choose a valid receipt printer.')
  }
  if (typeof value.autoPrintReceipt !== 'boolean') {
    throw new ReceiptServiceError(
      'invalid-input',
      'Choose whether to print receipts automatically.'
    )
  }

  const printerName = typeof value.printerName === 'string' ? value.printerName : null
  if (printerName !== null && printerName.trim() === '') {
    throw new ReceiptServiceError('invalid-input', 'Choose a valid receipt printer.')
  }
  return { printerName, autoPrintReceipt: value.autoPrintReceipt }
}

function parseSaleId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ReceiptServiceError('invalid-input', 'Choose a valid sale to print.')
  }
  return value
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }
    return entities[character]!
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

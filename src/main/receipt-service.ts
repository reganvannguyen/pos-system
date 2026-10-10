import type {
  PrinterOption,
  ReceiptApiError,
  ReceiptEmailDraftResult,
  ReceiptErrorCode,
  ReceiptPdfResult,
  ReceiptBusinessDetails,
  ReceiptPrintResult,
  ReceiptResult,
  ReceiptSettings,
  ReceiptTextDraftResult
} from '../shared/pos-api'
import type { SalesRepository } from './database/repositories/sales'
import type { SettingsRepository } from './database/repositories/settings'
import type { SaleDetailRecord } from './database/repositories/sales'
import type { SettingsRecord } from './database/types'
import {
  formatReceiptDateTime,
  renderReceiptHtml as renderReceiptTemplate,
  type ReceiptTemplateSale
} from '../shared/receipt-html'

export { renderReceiptHtml } from '../shared/receipt-html'

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
  createPdf: (html: string, saleId: number) => Promise<string>
  deletePdf: (path: string) => Promise<void>
  openEmailDraft: (
    recipient: string,
    subject: string,
    body: string,
    pdfPath: string
  ) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  showItemInFolder: (path: string) => void
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
  printHtml,
  createPdf,
  deletePdf,
  openEmailDraft,
  openExternal,
  showItemInFolder
}: ReceiptServiceDependencies) {
  const generatedPdfBySale = new Map<number, string>()
  return {
    async listPrinters(): Promise<PrinterOption[]> {
      return (await listSystemPrinters())
        .filter((printer) => typeof printer.name === 'string' && printer.name.length > 0)
        .map(toPrinterOption)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))
    },

    getSettings(): ReceiptSettings {
      const value = settings.get()
      return { printerName: value.printer_name }
    },

    async saveSettings(value: unknown): Promise<ReceiptSettings> {
      const parsed = parseReceiptSettings(value)
      if (parsed.printerName) {
        await ensurePrinterAvailable(parsed.printerName)
      }

      const saved = settings.saveReceipt(parsed.printerName)
      return { printerName: saved.printer_name }
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

      const html = renderReceiptTemplate(
        toReceiptTemplateSale(sale),
        toReceiptBusiness(currentSettings)
      )
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
    },

    async emailDraft(
      saleIdValue: unknown,
      recipientValue: unknown
    ): Promise<ReceiptEmailDraftResult> {
      const saleId = parseSaleId(saleIdValue)
      const recipient = parseEmail(recipientValue)
      const sale = getSale(saleId)
      const currentSettings = settings.get()
      const transactionLabel = sale.transaction_type === 'return' ? 'Return' : 'Invoice'
      const amountLabel = sale.transaction_type === 'return' ? 'Refunded' : 'Total'
      const transactionTotal = signedAmount(sale.total_cents, sale.transaction_type)
      const subject = `Receipt from ${currentSettings.business_name} · ${transactionLabel} #${sale.transaction_number}`
      const body = [
        `Attached is your receipt from ${currentSettings.business_name}.`,
        `${transactionLabel} #${sale.transaction_number} · ${amountLabel} ${formatMoney(transactionTotal)}`,
        sale.charge ? `Balance due: ${formatMoney(sale.charge.balance_cents)}` : '',
        currentSettings.business_email ? `Store contact: ${currentSettings.business_email}` : ''
      ]
        .filter(Boolean)
        .join('\n')
      const pdfPath = await createReceiptPdf(sale, currentSettings, saleId)
      const oldPdfPath = generatedPdfBySale.get(saleId)
      if (oldPdfPath) void deletePdf(oldPdfPath).catch(() => {})
      generatedPdfBySale.set(saleId, pdfPath)
      const attachmentIncluded = await openEmailDraft(recipient, subject, body, pdfPath).catch(
        () => false
      )

      if (attachmentIncluded) {
        generatedPdfBySale.delete(saleId)
        void deletePdf(pdfPath).catch(() => {})
      }

      const draftOpened = attachmentIncluded
        ? true
        : await openExternal(buildMailtoUrl(recipient, subject, body)).then(
            () => true,
            () => false
          )

      return { saleId, draftOpened, attachmentIncluded, subject, body }
    },

    async textDraft(
      saleIdValue: unknown,
      recipientValue: unknown
    ): Promise<ReceiptTextDraftResult> {
      const saleId = parseSaleId(saleIdValue)
      const recipient = parsePhone(recipientValue)
      const sale = getSale(saleId)
      const currentSettings = settings.get()
      const dateTime = formatReceiptDateTime(sale.created_at)
      const transactionLabel = sale.transaction_type === 'return' ? 'Return' : 'Invoice'
      const amountLabel = sale.transaction_type === 'return' ? 'Refunded' : 'Total'
      const balanceDue = sale.charge
        ? ` · Balance due ${formatMoney(sale.charge.balance_cents)}`
        : ''
      const message = `${currentSettings.business_name} · ${transactionLabel} #${sale.transaction_number} · ${dateTime.date} ${dateTime.time} · ${amountLabel} ${formatMoney(signedAmount(sale.total_cents, sale.transaction_type))}${balanceDue}`
      const draftOpened = await openExternal(buildTextUrl(recipient, message)).then(
        () => true,
        () => false
      )
      return { saleId, draftOpened, message }
    },

    async openPdf(saleIdValue: unknown): Promise<ReceiptPdfResult> {
      const saleId = parseSaleId(saleIdValue)
      let path = generatedPdfBySale.get(saleId)
      if (!path) {
        path = await createReceiptPdf(getSale(saleId), settings.get(), saleId)
        generatedPdfBySale.set(saleId, path)
      }
      showItemInFolder(path)
      return { saleId, opened: true }
    }
  }

  function getSale(saleId: number): SaleDetailRecord {
    const sale = sales.getById(saleId)
    if (!sale) throw new ReceiptServiceError('sale-not-found', 'This sale could not be found.')
    return sale
  }

  async function createReceiptPdf(
    sale: SaleDetailRecord,
    currentSettings: ReturnType<SettingsRepository['get']>,
    saleId: number
  ): Promise<string> {
    try {
      return await createPdf(
        renderReceiptTemplate(toReceiptTemplateSale(sale), toReceiptBusiness(currentSettings)),
        saleId
      )
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'PDF rendering failed.'
      throw new ReceiptServiceError('pdf-failed', `Receipt PDF could not be created. ${reason}`)
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

function toReceiptTemplateSale(sale: SaleDetailRecord): ReceiptTemplateSale {
  return {
    transactionNumber: sale.transaction_number,
    transactionType: sale.transaction_type,
    createdAt: sale.created_at,
    items: sale.items.map((item) => ({
      sku: item.sku,
      description: item.product_name,
      quantity: item.quantity,
      unitPriceCents: signedAmount(item.unit_price_cents, sale.transaction_type),
      lineTotalCents: signedAmount(item.line_total_cents, sale.transaction_type)
    })),
    subtotalCents: signedAmount(sale.subtotal_cents, sale.transaction_type),
    taxes: sale.tax_breakdown.map((tax) => ({
      name: tax.tax_name,
      rateBasisPoints: tax.rate_basis_points,
      taxCents: signedAmount(tax.tax_cents, sale.transaction_type)
    })),
    taxCents: signedAmount(sale.tax_cents, sale.transaction_type),
    totalCents: signedAmount(sale.total_cents, sale.transaction_type),
    payments: sale.payments.map((payment) => ({
      type: payment.payment_type,
      amountTenderedCents:
        payment.amount_tendered_cents === null
          ? null
          : signedAmount(payment.amount_tendered_cents, sale.transaction_type),
      amountAppliedCents: signedAmount(payment.amount_applied_cents, sale.transaction_type),
      changeCents: payment.change_cents
    })),
    charge: sale.charge
      ? {
          customer: {
            name: sale.charge.customer_name,
            companyName: sale.charge.company_name,
            address: sale.charge.address,
            phoneNumber: sale.charge.phone_number,
            email: sale.charge.email
          },
          amountCents: sale.charge.amount_cents,
          balanceCents: sale.charge.balance_cents
        }
      : null
  }
}

function toReceiptBusiness(settings: SettingsRecord): ReceiptBusinessDetails {
  return {
    businessName: settings.business_name,
    businessAddress: settings.business_address,
    businessCity: settings.business_city,
    businessProvince: settings.business_province,
    businessPostalCode: settings.business_postal_code,
    businessPhone: settings.business_phone,
    businessEmail: settings.business_email,
    businessGstNumber: settings.business_gst_number,
    businessWebsite: settings.business_website
  }
}

function parseReceiptSettings(value: unknown): ReceiptSettings {
  if (!isRecord(value)) {
    throw new ReceiptServiceError('invalid-input', 'Enter valid receipt settings.')
  }
  if (value.printerName !== null && typeof value.printerName !== 'string') {
    throw new ReceiptServiceError('invalid-input', 'Choose a valid receipt printer.')
  }
  const printerName = typeof value.printerName === 'string' ? value.printerName : null
  if (printerName !== null && printerName.trim() === '') {
    throw new ReceiptServiceError('invalid-input', 'Choose a valid receipt printer.')
  }
  return { printerName }
}

function parseEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReceiptServiceError('invalid-input', 'Enter a valid email address.')
  }
  const email = value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ReceiptServiceError('invalid-input', 'Enter a valid email address.')
  }
  return email
}

function parsePhone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReceiptServiceError('invalid-input', 'Enter a valid phone number.')
  }
  const phone = value.trim()
  const normalized = phone.replace(/[\s().-]/g, '')
  if (!/^\+?\d{7,15}$/.test(normalized)) {
    throw new ReceiptServiceError('invalid-input', 'Enter a phone number with 7 to 15 digits.')
  }
  return normalized
}

export function buildMailtoUrl(recipient: string, subject: string, body: string): string {
  const query = new URLSearchParams({ subject, body })
  return `mailto:${encodeURIComponent(recipient)}?${query.toString()}`
}

export function buildTextUrl(recipient: string, body: string, platform = process.platform): string {
  const query = new URLSearchParams({ Addresses: recipient, Body: body })
  return platform === 'win32'
    ? `ms-chat:?${query.toString()}`
    : `sms:${encodeURIComponent(recipient)}?body=${encodeURIComponent(body)}`
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

function signedAmount(cents: number, type: 'sale' | 'return'): number {
  return type === 'return' ? (cents === 0 ? 0 : -cents) : cents
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

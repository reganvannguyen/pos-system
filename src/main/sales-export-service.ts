import type {
  SalesCsvExportResult,
  SalesPdfExportResult,
  SaleSummary,
  SalesSummaryGroup
} from '../shared/pos-api'
import { isSalesSummaryGroup, recognizedSalesSummaryGroups } from '../shared/sales-report-summary'
import type { SalesService } from './sales-service'
import { SalesServiceError } from './sales-service'
import { resolveSalesPeriod } from './sales-period'
import { renderSalesReportPdfHtml } from './sales-report-pdf'

export type SaveSalesCsvFile = (fileName: string, contents: string) => Promise<boolean>
export type SaveSalesPdfFile = (fileName: string, html: string) => Promise<boolean>

export function createSalesExportService(
  sales: SalesService,
  saveCsvFile: SaveSalesCsvFile,
  savePdfFile?: SaveSalesPdfFile
) {
  return {
    async exportCsv(period: unknown): Promise<SalesCsvExportResult> {
      const report = sales.report(period)
      const { fileName } = resolveSalesPeriod(period)

      let saved: boolean
      try {
        saved = await saveCsvFile(fileName, serializeSalesCsv(report.sales))
      } catch {
        throw new SalesServiceError(
          'export-failed',
          'The CSV could not be saved. Choose another location and try again.'
        )
      }

      return saved ? { canceled: false, rowCount: report.sales.length } : { canceled: true }
    },

    async exportPdf(period: unknown, summaryGroupsValue: unknown): Promise<SalesPdfExportResult> {
      if (!savePdfFile) {
        throw new SalesServiceError('export-failed', 'PDF export is not available.')
      }

      const summaryGroups = parseSummaryGroups(summaryGroupsValue)
      const report = sales.report(period)
      const productsByDay = sales.productsByDayInPeriod(period)
      const { fileName } = resolveSalesPeriod(period)
      const pdfFileName = fileName.replace(/\.csv$/i, '.pdf')

      let saved: boolean
      try {
        const html = renderSalesReportPdfHtml({
          periodLabel: formatPeriodLabel(period),
          report,
          summaryGroups,
          productsByDay
        })
        saved = await savePdfFile(pdfFileName, html)
      } catch {
        throw new SalesServiceError(
          'export-failed',
          'The PDF report could not be created or saved. Choose another location and try again.'
        )
      }

      return saved ? { canceled: false, rowCount: report.sales.length } : { canceled: true }
    }
  }
}

function parseSummaryGroups(value: unknown): SalesSummaryGroup[] {
  if (!Array.isArray(value) || value.some((group) => !isSalesSummaryGroup(group))) {
    throw new SalesServiceError('invalid-input', 'Choose valid sales summary groups.')
  }
  const selected = new Set(value)
  return recognizedSalesSummaryGroups
    .filter((group) => selected.has(group.value))
    .map((group) => group.value)
}

function formatPeriodLabel(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'Selected period'
  }
  const period = value as Record<string, unknown>
  switch (period.type) {
    case 'day':
      return `Day · ${formatDateInput(period.date)}`
    case 'week':
      return `Week of ${formatDateInput(period.date)}`
    case 'month':
      return `Month · ${String(period.month)}`
    case 'year':
      return `Year · ${String(period.year)}`
    case 'custom':
      return `From ${formatDateInput(period.startDate)} through ${formatDateInput(period.endDate)}`
    default:
      return 'Selected period'
  }
}

function formatDateInput(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value ?? '')
  const [year, month, day] = value.split('-')
  return `${day}/${month}/${year.slice(-2)}`
}

export function serializeSalesCsv(sales: SaleSummary[]): string {
  const headers = [
    'transaction_type',
    'transaction_number',
    'created_at_local',
    'payment_method',
    'payment_breakdown',
    'return_reason',
    'item_count',
    'subtotal_cad',
    'tax_cad',
    'total_cad'
  ]
  const rows = sales.map((sale) => [
    sale.transactionType,
    `${sale.transactionType === 'return' ? 'Return' : 'Invoice'} #${sale.transactionNumber}`,
    formatLocalTimestamp(sale.createdAt),
    sale.paymentMethod,
    sale.payments
      .map((payment) => {
        const type = payment.type === 'card' ? 'Card (type unknown)' : titleCase(payment.type)
        if (sale.transactionType === 'return') {
          return `${type}: refunded ${formatCents(payment.amountAppliedCents)}`
        }
        const tendered =
          payment.amountTenderedCents === null
            ? 'unknown'
            : formatCents(payment.amountTenderedCents)
        return `${type}: tendered ${tendered}, applied ${formatCents(payment.amountAppliedCents)}, change ${formatCents(payment.changeCents)}`
      })
      .join('; '),
    sale.returnReason ?? '',
    String(sale.itemCount),
    formatCents(sale.subtotalCents),
    formatCents(sale.taxCents),
    formatCents(sale.totalCents)
  ])

  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatLocalTimestamp(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value

  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatCents(value: number): string {
  const isNegative = value < 0
  const cents = BigInt(isNegative ? -value : value)
  const dollars = cents / 100n
  const remainder = String(cents % 100n).padStart(2, '0')
  return `${isNegative ? '-' : ''}${dollars}.${remainder}`
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

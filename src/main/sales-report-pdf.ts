import type { SalesSummaryGroup, SaleSummary, SalesReport } from '../shared/pos-api'
import { getSalesSummaryMetricsForGroups } from '../shared/sales-report-summary'
import type { DailyProductBreakdown } from './sales-service'

export interface SalesReportPdfDocument {
  periodLabel: string
  report: SalesReport
  summaryGroups: SalesSummaryGroup[]
  productsByDay: DailyProductBreakdown[]
}

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

export function renderSalesReportPdfHtml(document: SalesReportPdfDocument): string {
  const summaryMetrics = getSalesSummaryMetricsForGroups(
    document.report.totals,
    document.summaryGroups
  )
  const transactionRows = document.report.sales.map(renderTransactionRow).join('')
  const productSections = document.productsByDay.map(renderProductDay).join('')
  const summarySection =
    summaryMetrics.length === 0
      ? ''
      : `<section class="summary-section"><h2>Summary</h2><div class="summary-grid">${summaryMetrics
          .map(
            (metric) =>
              `<div class="summary-card${metric.emphasized ? ' emphasized' : ''}"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.kind === 'money' ? formatCents(metric.value) : String(metric.value))}</strong></div>`
          )
          .join('')}</div></section>`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sales report · ${escapeHtml(document.periodLabel)}</title>
  <style>
    @page { size: Letter landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #202a31; font: 10px Arial, sans-serif; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    h2 { margin: 18px 0 8px; font-size: 14px; break-after: avoid; }
    h3 { margin: 13px 0 6px; font-size: 11px; break-after: avoid; }
    .report-meta { margin-bottom: 14px; color: #596873; font-size: 11px; }
    .summary-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; }
    .summary-card { min-height: 52px; padding: 8px; border: 1px solid #d8dfe3; border-radius: 3px; }
    .summary-card span { display: block; margin-bottom: 5px; color: #66757e; font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .summary-card strong { font-size: 13px; }
    .summary-card.emphasized { border-color: #202a31; background: #f0f2f3; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th { padding: 6px 5px; background: #eef1f3; color: #56646d; font-size: 8px; text-align: left; text-transform: uppercase; }
    td { padding: 6px 5px; border-bottom: 1px solid #dfe4e7; vertical-align: top; overflow-wrap: anywhere; }
    tr { break-inside: avoid; }
    .transactions th:nth-child(1) { width: 13%; }
    .transactions th:nth-child(2) { width: 11%; }
    .transactions th:nth-child(3) { width: 21%; }
    .transactions th:nth-child(4) { width: 5%; text-align: right; }
    .transactions th:nth-child(5), .transactions th:nth-child(6), .transactions th:nth-child(7) { width: 8%; text-align: right; }
    .transactions th:nth-child(8) { width: 18%; }
    .transactions td:nth-child(4), .transactions td:nth-child(5), .transactions td:nth-child(6), .transactions td:nth-child(7) { text-align: right; white-space: nowrap; }
    .transactions td:nth-child(7) { font-weight: 700; }
    .transactions .return-row { color: #a33d35; }
    .transaction-number { display: block; font-weight: 700; }
    .subtext { display: block; margin-top: 3px; color: #63717a; font-size: 8px; line-height: 1.35; }
    .products th:nth-child(3), .products th:nth-child(4), .products td:nth-child(3), .products td:nth-child(4) { text-align: right; }
    .products th:nth-child(3) { width: 15%; }
    .products th:nth-child(4) { width: 22%; }
    .products td:last-child { font-weight: 700; }
    .empty { padding: 9px 5px; color: #66757e; }
  </style>
</head>
<body>
  <header>
    <h1>Sales report</h1>
    <div class="report-meta">${escapeHtml(document.periodLabel)} · ${document.report.totals.transactionCount} ${document.report.totals.transactionCount === 1 ? 'transaction' : 'transactions'}</div>
  </header>
  ${summarySection}
  <section>
    <h2>Transactions</h2>
    <table class="transactions">
      <thead><tr><th>Transaction</th><th>Date / time</th><th>Payment and tender</th><th>Items</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Return reason</th></tr></thead>
      <tbody>${transactionRows || '<tr><td class="empty" colspan="8">No transactions in this period.</td></tr>'}</tbody>
    </table>
  </section>
  <section>
    <h2>Products by day</h2>
    ${productSections || '<p class="empty">No product details in this period.</p>'}
  </section>
</body>
</html>`
}

function renderTransactionRow(sale: SaleSummary): string {
  const label = sale.transactionType === 'return' ? 'Return' : 'Invoice'
  const payments = sale.payments.map((payment) => {
    const type = payment.type === 'card' ? 'Card (type unknown)' : titleCase(payment.type)
    if (sale.transactionType === 'return') {
      return `${type}: refunded ${formatCents(payment.amountAppliedCents)}`
    }
    const tendered =
      payment.amountTenderedCents === null ? 'unknown' : formatCents(payment.amountTenderedCents)
    return `${type}: tendered ${tendered}, applied ${formatCents(payment.amountAppliedCents)}, change ${formatCents(payment.changeCents)}`
  })
  if (sale.chargeAmountCents !== null) {
    payments.push(
      `Charge: ${formatCents(sale.chargeAmountCents)}, balance due ${formatCents(sale.chargeBalanceCents ?? 0)}`
    )
  }
  const paymentMethod = titleCase(sale.paymentMethod)

  return `<tr class="${sale.transactionType === 'return' ? 'return-row' : ''}">
    <td><span class="transaction-number">${escapeHtml(label)} #${escapeHtml(sale.transactionNumber)}</span></td>
    <td>${escapeHtml(formatLocalDateTime(sale.createdAt))}</td>
    <td>${escapeHtml(paymentMethod)}${payments.length ? `<span class="subtext">${payments.map((payment) => escapeHtml(payment)).join('<br>')}</span>` : ''}</td>
    <td>${sale.itemCount}</td>
    <td>${escapeHtml(formatCents(sale.subtotalCents))}</td>
    <td>${escapeHtml(formatCents(sale.taxCents))}</td>
    <td>${escapeHtml(formatCents(sale.totalCents))}</td>
    <td>${escapeHtml(sale.returnReason ?? '')}</td>
  </tr>`
}

function renderProductDay(day: DailyProductBreakdown): string {
  const rows = day.products
    .map(
      (product) => `<tr>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.sku)}</td>
        <td>${product.netQuantity}</td>
        <td>${escapeHtml(formatCents(product.netAmountCents))}</td>
      </tr>`
    )
    .join('')

  return `<section class="day-products">
    <h3>${escapeHtml(formatLocalDay(day.date))}</h3>
    <table class="products">
      <thead><tr><th>Product</th><th>SKU</th><th>Net quantity</th><th>Net amount (before tax)</th></tr></thead>
      <tbody>${rows || '<tr><td class="empty" colspan="4">No product details for this day.</td></tr>'}</tbody>
    </table>
  </section>`
}

function formatCents(cents: number): string {
  return currencyFormatter.format(cents / 100)
}

function formatLocalDateTime(value: string): string {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return `${formatLocalDay(date)} ${new Intl.DateTimeFormat('en-CA', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date)}`
}

function formatLocalDay(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : value
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).formatToParts(date)
  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('day')}/${byType.get('month')}/${byType.get('year')}`
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

import type {
  BusinessSettings,
  SalesPdfReportType,
  SalesSummaryGroup,
  SaleSummary,
  SalesReport
} from '../shared/pos-api'
import { getSalesSummaryMetricsForGroups } from '../shared/sales-report-summary'
import type { SalesReportChargeRepayment, SalesReportProductTotal } from './sales-service'

export interface SalesReportPdfDocument {
  periodLabel: string
  report: SalesReport
  summaryGroups: SalesSummaryGroup[]
  products: SalesReportProductTotal[]
  chargeRepayments: SalesReportChargeRepayment[]
  reportType: SalesPdfReportType
  businessDetails?: BusinessSettings
}

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

export function renderSalesReportPdfHtml(document: SalesReportPdfDocument): string {
  const { totals } = document.report
  const taxCardMetrics = document.report.taxTotals.map((tax) => ({
    label: `${displayTaxName(tax.taxName)} net tax`,
    value: tax.netTaxCents,
    kind: 'money' as const
  }))
  const summaryMetrics = [
    { label: 'Net subtotal', value: totals.netSubtotalCents, kind: 'money' as const },
    ...taxCardMetrics,
    { label: 'Net total', value: totals.netTotalCents, kind: 'money' as const, emphasized: true },
    ...getSalesSummaryMetricsForGroups(totals, document.summaryGroups).filter(
      (metric) => metric.label !== 'Net tax'
    )
  ]
  const seenSummaryLabels = new Set<string>()
  const uniqueSummaryMetrics = summaryMetrics.filter((metric) => {
    if (seenSummaryLabels.has(metric.label)) return false
    seenSummaryLabels.add(metric.label)
    return true
  })
  const paymentMetrics = [
    { label: 'Cash received', value: totals.cashReceivedCents },
    { label: 'Debit received', value: totals.debitReceivedCents },
    { label: 'Credit received', value: totals.creditReceivedCents },
    { label: 'E-transfer received', value: totals.etransferReceivedCents },
    { label: 'Check received', value: totals.checkReceivedCents }
  ]
  const transactionRows = document.report.sales.map(renderTransactionRow).join('')
  const taxRows = document.report.taxTotals
    .map(
      (tax) => `<tr>
        <td>${escapeHtml(displayTaxName(tax.taxName))}</td>
        <td>${escapeHtml(formatCents(tax.salesTaxCents))}</td>
        <td>${escapeHtml(formatCents(tax.returnsTaxCents))}</td>
        <td>${escapeHtml(formatCents(tax.netTaxCents))}</td>
      </tr>`
    )
    .join('')
  const taxNames = document.report.taxTotals.map((tax) => tax.taxName)
  const productRows = document.products
    .map((product) => {
      const taxAmounts = new Map(product.taxAmounts.map((tax) => [tax.name, tax.amountCents]))
      return `<tr>
        <td>${escapeHtml(product.name)}</td>
        <td>${escapeHtml(product.sku || '—')}</td>
        <td class="number">${product.netQuantity}</td>
        <td class="number">${escapeHtml(formatCents(product.subtotalCents))}</td>
        ${taxNames.map((name) => `<td class="number">${escapeHtml(formatCents(taxAmounts.get(name) ?? 0))}</td>`).join('')}
        <td class="number total-cell">${escapeHtml(formatCents(product.totalCents))}</td>
        <td class="number">${escapeHtml(formatCents(product.tenderAmounts.cash))}</td>
        <td class="number">${escapeHtml(formatCents(product.tenderAmounts.debit))}</td>
        <td class="number">${escapeHtml(formatCents(product.tenderAmounts.credit))}</td>
        <td class="number">${escapeHtml(formatCents(product.tenderAmounts.charge))}</td>
      </tr>`
    })
    .join('')
  const itemTotals = document.products.reduce(
    (totals, product) => ({
      netQuantity: totals.netQuantity + product.netQuantity,
      netAmountCents: totals.netAmountCents + product.subtotalCents,
      cashCents: totals.cashCents + product.tenderAmounts.cash,
      debitCents: totals.debitCents + product.tenderAmounts.debit,
      creditCents: totals.creditCents + product.tenderAmounts.credit,
      chargeCents: totals.chargeCents + product.tenderAmounts.charge
    }),
    {
      netQuantity: 0,
      netAmountCents: 0,
      cashCents: 0,
      debitCents: 0,
      creditCents: 0,
      chargeCents: 0
    }
  )
  const itemTaxTotals = new Map(taxNames.map((name) => [name, 0]))
  for (const product of document.products) {
    for (const tax of product.taxAmounts) {
      itemTaxTotals.set(tax.name, (itemTaxTotals.get(tax.name) ?? 0) + tax.amountCents)
    }
  }
  const repaymentTotalCents = document.chargeRepayments.reduce(
    (total, payment) => total + payment.amountCents,
    0
  )
  const repaymentRows = document.chargeRepayments
    .map(
      (payment) => `<tr>
        <td>${escapeHtml(formatLocalDateTime(payment.createdAt))}</td>
        <td>${escapeHtml(chargePaymentLabel(payment.type))}</td>
        <td class="number">${escapeHtml(formatCents(payment.amountCents))}</td>
      </tr>`
    )
    .join('')
  const reportTitle =
    document.reportType === 'summary' ? 'Summary sales report' : 'Itemized sales report'
  const mastheadTitle =
    document.reportType === 'summary' ? 'Sales Summary' : 'Itemized Sales Report'
  const cityProvince = [
    document.businessDetails?.businessCity,
    document.businessDetails?.businessProvince
  ]
    .filter(Boolean)
    .join(', ')
  const locality = [cityProvince, document.businessDetails?.businessPostalCode]
    .filter(Boolean)
    .join(' ')
  const businessAddressLines = [
    document.businessDetails?.businessName,
    document.businessDetails?.businessAddress,
    locality
  ].filter((line): line is string => Boolean(line))
  const reportDate = new Intl.DateTimeFormat('en-CA', {
    month: 'short',
    day: '2-digit',
    year: 'numeric'
  }).format(new Date())
  const summarySection = `<section class="summary-section"><h2>Summary</h2><div class="summary-grid">${uniqueSummaryMetrics
    .map(
      (metric) =>
        `<div class="summary-card${'emphasized' in metric && metric.emphasized ? ' emphasized' : ''}"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(metric.kind === 'money' ? formatCents(metric.value) : String(metric.value))}</strong></div>`
    )
    .join('')}</div></section>`
  const paymentsSection = `<section class="payment-summary"><h2>Payments received by tender</h2><div class="summary-grid">${paymentMetrics
    .map(
      (metric) =>
        `<div class="summary-card"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(formatCents(metric.value))}</strong></div>`
    )
    .join('')}</div></section>`
  const taxSection = `<section class="tax-summary"><h2>Tax totals by type</h2><table class="tax-totals">
    <thead><tr><th>Tax</th><th>Sales</th><th>Returns</th><th>Net</th></tr></thead>
    <tbody>${taxRows || '<tr><td class="empty" colspan="4">No tax details in this period.</td></tr>'}</tbody>
    <tfoot><tr><td>Total</td><td>${escapeHtml(formatCents(totals.grossSalesTaxCents))}</td><td>${escapeHtml(formatCents(totals.returnsTaxCents))}</td><td>${escapeHtml(formatCents(totals.netTaxCents))}</td></tr></tfoot>
  </table></section>`

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(reportTitle)} · ${escapeHtml(document.periodLabel)}</title>
  <style>
    @page { size: Letter landscape; margin: 12mm; }
    * { box-sizing: border-box; }
    html { background: #fff; }
    body { margin: 0; background: #fff; color: #202a31; font: 10px Arial, sans-serif; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    h2 { margin: 18px 0 8px; font-size: 14px; break-after: avoid; }
    h3 { margin: 13px 0 6px; font-size: 11px; break-after: avoid; }
    header { padding-bottom: 9px; border-bottom: 2px solid #222; }
    header h1 { margin-bottom: 14px; text-align: center; }
    .report-identification { display: flex; justify-content: space-between; gap: 24px; color: #202a31; font-size: 10px; line-height: 1.45; }
    .business-details { display: grid; align-content: start; }
    .business-details strong { font-weight: 700; }
    .report-context { display: grid; align-content: start; justify-items: end; gap: 2px; text-align: right; }
    .report-context strong { font-weight: 700; }
    .summary-section h2, .payment-summary h2 { margin-top: 14px; }
    .summary-section, .payment-summary { break-inside: avoid; }
    .summary-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 7px; }
    .summary-card { min-height: 52px; padding: 8px; border: 1px solid #d8dfe3; border-radius: 3px; }
    .summary-card span { display: block; margin-bottom: 5px; color: #66757e; font-size: 8px; font-weight: 700; text-transform: uppercase; }
    .summary-card strong { font-size: 13px; }
    .summary-card.emphasized { border-color: #202a31; background: #f0f2f3; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    th { padding: 5px; border-bottom: 2px solid #252b30; background: transparent; color: #303a40; font-size: 8px; text-align: left; text-transform: none; }
    td { padding: 4px 5px; border-bottom: 0; vertical-align: top; overflow-wrap: anywhere; }
    tr { break-inside: avoid; }
    tfoot td { border-top: 1.5px solid #252b30; font-weight: 700; }
    section h2 { padding-bottom: 4px; border-bottom: 1px solid #87929a; }
    .transactions th:nth-child(1) { width: 13%; }
    .transactions th:nth-child(2) { width: 11%; }
    .transactions th:nth-child(3) { width: 21%; }
    .transactions th:nth-child(4) { width: 5%; text-align: right; }
    .transactions th:nth-child(5), .transactions th:nth-child(6), .transactions th:nth-child(7) { width: 8%; text-align: right; }
    .transactions th:nth-child(8) { width: 18%; }
    .transactions td:nth-child(4), .transactions td:nth-child(5), .transactions td:nth-child(6), .transactions td:nth-child(7) { text-align: right; white-space: nowrap; }
    .transactions tfoot td:not(:first-child) { text-align: right; white-space: nowrap; }
    .transactions td:nth-child(7) { font-weight: 700; }
    .transactions .return-row { color: #a33d35; }
    .transaction-number { display: block; font-weight: 700; }
    .subtext { display: block; margin-top: 3px; color: #63717a; font-size: 8px; line-height: 1.35; }
    .tax-totals th:not(:first-child), .tax-totals td:not(:first-child) { text-align: right; }
    .tax-totals td:last-child { font-weight: 700; }
    .products { font-size: 8px; }
    .products th, .products td { padding: 4px 3px; }
    .products .number { text-align: right; white-space: nowrap; }
    .products .total-cell, .products tfoot td { font-weight: 700; }
    .repayments th:last-child, .repayments td:last-child { text-align: right; }
    .report-note { margin: 6px 0 0; color: #66757e; font-size: 8px; }
    .empty { padding: 9px 5px; color: #66757e; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(mastheadTitle)}</h1>
    <div class="report-identification">
      <div class="business-details">${businessAddressLines
        .map((line, index) =>
          index === 0 ? `<strong>${escapeHtml(line)}</strong>` : `<span>${escapeHtml(line)}</span>`
        )
        .join('')}</div>
      <div class="report-context">
        <div><strong>Date:</strong> ${escapeHtml(reportDate)}</div>
        <div><strong>Report Period:</strong> ${escapeHtml(document.periodLabel)}</div>
        <div><strong>Report Type:</strong> ${document.reportType === 'summary' ? 'Summary sales' : 'Itemized'}</div>
        <div><strong>Transactions:</strong> ${document.report.totals.transactionCount}</div>
      </div>
    </div>
  </header>
  ${summarySection}
  ${
    document.reportType === 'itemized'
      ? `${paymentsSection}
  ${taxSection}
  <section>
    <h2>Transactions</h2>
    <table class="transactions">
      <thead><tr><th>Transaction</th><th>Date / time</th><th>Payment and tender</th><th>Items</th><th>Subtotal</th><th>Tax</th><th>Total</th><th>Return reason</th></tr></thead>
      <tbody>${transactionRows || '<tr><td class="empty" colspan="8">No transactions in this period.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="3">Net totals · ${document.report.totals.transactionCount} transactions</td><td></td><td>${escapeHtml(formatCents(totals.netSubtotalCents))}</td><td>${escapeHtml(formatCents(totals.netTaxCents))}</td><td>${escapeHtml(formatCents(totals.netTotalCents))}</td><td></td></tr></tfoot>
    </table>
    <h2>Item totals for the period</h2>
    <table class="products">
      <colgroup>
        <col style="width: ${taxNames.length ? 19 : 39}%"><col style="width: 8%"><col style="width: 5%"><col style="width: 10%">
        ${taxNames.map(() => `<col style="width: ${20 / taxNames.length}%">`).join('')}
        <col style="width: 10%"><col style="width: 7%"><col style="width: 7%"><col style="width: 7%"><col style="width: 7%">
      </colgroup>
      <thead><tr><th>Product</th><th>SKU</th><th class="number">Net quantity</th><th class="number">Net amount before tax</th>
        ${taxNames.map((name) => `<th class="number">${escapeHtml(displayTaxName(name))} tax</th>`).join('')}
        <th class="number">Net total incl. tax</th><th class="number">Cash</th><th class="number">Debit</th><th class="number">Credit</th><th class="number">Charge at sale</th>
      </tr></thead>
      <tbody>${productRows || `<tr><td class="empty" colspan="${9 + taxNames.length}">No product details in this period.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="2">Totals</td><td class="number">${itemTotals.netQuantity}</td><td class="number">${escapeHtml(formatCents(itemTotals.netAmountCents))}</td>
        ${taxNames.map((name) => `<td class="number">${escapeHtml(formatCents(itemTaxTotals.get(name) ?? 0))}</td>`).join('')}
        <td class="number">${escapeHtml(formatCents(document.report.totals.netTotalCents))}</td>
        <td class="number">${escapeHtml(formatCents(itemTotals.cashCents))}</td><td class="number">${escapeHtml(formatCents(itemTotals.debitCents))}</td>
        <td class="number">${escapeHtml(formatCents(itemTotals.creditCents))}</td><td class="number">${escapeHtml(formatCents(itemTotals.chargeCents))}</td>
      </tr></tfoot>
    </table>
    <p class="report-note">Sale and return tenders are allocated to items by their pre-tax value. Charge shows the amount left unpaid at sale. Later repayments are listed by the date recorded.</p>
    <h2>Charge repayments received in this period</h2>
    <table class="repayments">
      <thead><tr><th>Recorded date</th><th>Tender</th><th>Amount received</th></tr></thead>
      <tbody>${repaymentRows || '<tr><td class="empty" colspan="3">No Charge repayments in this period.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="2">Total repayments</td><td>${escapeHtml(formatCents(repaymentTotalCents))}</td></tr></tfoot>
    </table>
  </section>`
      : ''
  }
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

function displayTaxName(name: string): string {
  const normalizedName = name.trim().replace(/\s+/g, ' ').toLowerCase()
  if (normalizedName === 'provincial tax (pst)') return 'PST'
  if (normalizedName === 'federal tax (gst)' || normalizedName === 'ferderal tax (gst)') {
    return 'GST'
  }
  return name
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

function chargePaymentLabel(value: SalesReportChargeRepayment['type']): string {
  if (value === 'etransfer') return 'E-transfer'
  return titleCase(value)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

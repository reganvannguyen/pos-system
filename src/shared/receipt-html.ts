import type { ReceiptBusinessDetails } from './pos-api'

export interface ReceiptTemplateSale {
  transactionNumber: string
  transactionType?: 'sale' | 'return'
  createdAt: string
  items: Array<{
    sku: string
    description: string
    quantity: number
    unitPriceCents: number
    lineTotalCents: number
  }>
  subtotalCents: number
  taxes: Array<{ name: string; rateBasisPoints: number; taxCents: number }>
  taxCents: number
  totalCents: number
  payments: Array<{
    type: string
    amountTenderedCents: number | null
    amountAppliedCents: number
    changeCents: number
  }>
  charge?: {
    customer: {
      name: string
      companyName: string
      address: string
      phoneNumber: string
      email: string
    }
    amountCents: number
    balanceCents: number
  } | null
}

export function renderReceiptHtml(
  sale: ReceiptTemplateSale,
  business: ReceiptBusinessDetails,
  isPreview = false
): string {
  const isReturn = sale.transactionType === 'return'
  const items = sale.items
    .map(
      (item) => `<tr>
        <td class="description">${escapeHtml(item.description)}<small>SKU ${escapeHtml(item.sku)}</small></td>
        <td class="quantity">${item.quantity}</td>
        <td class="price">${formatMoney(item.unitPriceCents)}</td>
        <td class="line-total">${formatMoney(item.lineTotalCents)}</td>
      </tr>`
    )
    .join('')

  const taxRows = sale.taxes
    .map(
      (tax) =>
        `<div><span>${escapeHtml(tax.name)} (${formatTaxRate(tax.rateBasisPoints)}%)</span><span>${formatMoney(tax.taxCents)}</span></div>`
    )
    .join('')

  const tendered = sale.payments.some((payment) => payment.amountTenderedCents === null)
    ? 'Unknown'
    : formatMoney(
        sale.payments.reduce((total, payment) => total + (payment.amountTenderedCents ?? 0), 0)
      )
  const change = sale.payments.reduce((total, payment) => total + payment.changeCents, 0)
  const paymentTypes = [...new Set(sale.payments.map(({ type }) => tenderLabel(type)))].join(' + ')
  const chargePaymentTypes = sale.charge
    ? [paymentTypes, 'Charge'].filter(Boolean).join(' + ')
    : paymentTypes
  const dateTime = formatReceiptDateTime(sale.createdAt)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${isReturn ? 'Return' : 'Invoice'} #${escapeHtml(sale.transactionNumber)}</title>
  <style>
    @page { margin: 0; }
    * { box-sizing: border-box; }
    body { width: 100%; max-width: 58mm; margin: 0 auto; padding: 4mm; color: #000; font: 600 11px/1.35 Consolas, "Courier New", monospace; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    header { text-align: center; margin-bottom: 9px; }
    h1 { margin: 0 0 4px; font-size: 17px; overflow-wrap: anywhere; }
    p { margin: 2px 0; overflow-wrap: anywhere; }
    .muted { color: #000; }
    .separator { border-top: 1px dashed #000; margin: 7px 0; }
    .invoice-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; }
    .invoice-meta p:first-child { grid-column: 1 / -1; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th { padding: 4px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; text-align: left; font-size: 9px; }
    td { padding: 5px 0; vertical-align: top; overflow-wrap: anywhere; }
    th:nth-child(1), td:nth-child(1) { width: 30%; }
    th:nth-child(2), td:nth-child(2) { width: 8%; text-align: center; }
    th:nth-child(3), td:nth-child(3) { width: 31%; text-align: right; }
    th:nth-child(4), td:nth-child(4) { width: 31%; text-align: right; }
    .description small { display: block; color: #000; font-size: 9px; }
    .price, .line-total { font-size: 10px; white-space: nowrap; }
    .totals { margin-top: 7px; padding-top: 6px; border-top: 1px dashed #333; }
    .totals div { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
    .total { margin-top: 4px; padding-top: 5px !important; border-top: 1px solid #111; font-weight: 700; }
    .payment-details { margin-top: 7px; }
    .customer-details { margin: 5px 0 9px; padding: 6px 0; border-top: 1px dashed #000; border-bottom: 1px dashed #000; }
    .customer-details strong { display: block; margin-bottom: 3px; }
    footer { margin-top: 9px; padding-top: 7px; border-top: 1px dashed #333; text-align: center; }
    .preview-note { color: #555; font-size: 9px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(business.businessName || 'Your company name')}</h1>
    ${business.businessAddress ? `<p>${escapeHtml(business.businessAddress)}</p>` : ''}
    ${formatLocality(business) ? `<p>${escapeHtml(formatLocality(business))}</p>` : ''}
    ${business.businessPhone ? `<p>${escapeHtml(business.businessPhone)}</p>` : ''}
    ${business.businessEmail ? `<p>${escapeHtml(business.businessEmail)}</p>` : ''}
    <div class="separator"></div>
    ${isPreview ? '<p class="preview-note">SAMPLE PREVIEW</p>' : ''}
    <div class="invoice-meta">
      <p>${isReturn ? 'RETURN NO.' : 'INVOICE NO.'} ${escapeHtml(sale.transactionNumber)}</p>
      <p>DATE: ${dateTime.date}</p>
      <p>TIME: ${dateTime.time}</p>
    </div>
  </header>
  ${
    sale.charge
      ? `<section class="customer-details" aria-label="Customer details">
    <strong>CHARGED TO</strong>
    <p>${escapeHtml(sale.charge.customer.name)}</p>
    ${sale.charge.customer.companyName ? `<p>${escapeHtml(sale.charge.customer.companyName)}</p>` : ''}
    ${sale.charge.customer.address ? `<p>${escapeHtml(sale.charge.customer.address)}</p>` : ''}
    ${sale.charge.customer.phoneNumber ? `<p>${escapeHtml(sale.charge.customer.phoneNumber)}</p>` : ''}
    ${sale.charge.customer.email ? `<p>${escapeHtml(sale.charge.customer.email)}</p>` : ''}
  </section>`
      : ''
  }
  <table aria-label="${isReturn ? 'Returned' : 'Purchased'} items">
    <thead><tr><th>Description</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${items}</tbody>
  </table>
  <section class="totals" aria-label="${isReturn ? 'Return' : 'Invoice'} totals">
    <div><span>Subtotal</span><span>${formatMoney(sale.subtotalCents)}</span></div>
    ${taxRows}
    ${sale.taxes.length ? `<div><span>Tax total</span><span>${formatMoney(sale.taxCents)}</span></div>` : ''}
    <div class="total"><span>Total</span><span>${formatMoney(sale.totalCents)}</span></div>
    <div class="payment-details"><span>${isReturn ? 'Amount refunded' : sale.charge ? 'Paid now' : 'Amount tendered'}</span><span>${tendered}</span></div>
    ${isReturn ? '' : `<div><span>Change due</span><span>${formatMoney(change)}</span></div>`}
    ${sale.charge ? `<div><span>Amount charged</span><span>${formatMoney(sale.charge.amountCents)}</span></div><div class="total"><span>Balance due</span><span>${formatMoney(sale.charge.balanceCents)}</span></div>` : ''}
    <div><span>${isReturn ? 'Refund method' : 'Payment type'}</span><span>${escapeHtml(chargePaymentTypes || 'No payment required')}</span></div>
  </section>
  <footer>
    ${business.businessGstNumber ? `<p>GST/HST #${escapeHtml(business.businessGstNumber)}</p>` : ''}
    ${business.businessWebsite ? `<p>${escapeHtml(business.businessWebsite)}</p>` : ''}
    <p>${isReturn ? 'Return processed' : 'Thank you for your purchase'}</p>
  </footer>
</body>
</html>`
}

export function renderReceiptPreviewHtml(business: ReceiptBusinessDetails): string {
  return renderReceiptHtml(
    {
      transactionNumber: '20251008-0001',
      createdAt: '2025-10-08 17:12:00',
      items: [
        {
          sku: '0668',
          description: 'Passport / Photo / PR ID Card',
          quantity: 1,
          unitPriceCents: 1785,
          lineTotalCents: 1785
        }
      ],
      subtotalCents: 1785,
      taxes: [
        { name: 'GST', rateBasisPoints: 500, taxCents: 89 },
        { name: 'PST', rateBasisPoints: 700, taxCents: 125 }
      ],
      taxCents: 214,
      totalCents: 1999,
      charge: null,
      payments: [
        {
          type: 'cash',
          amountTenderedCents: 1999,
          amountAppliedCents: 1999,
          changeCents: 0
        }
      ]
    },
    business,
    true
  )
}

export function formatReceiptDateTime(value: string): { date: string; time: string } {
  return { date: formatLocalDate(value), time: formatLocalTime(value) }
}

function formatLocality(business: ReceiptBusinessDetails): string {
  const cityProvince = [business.businessCity, business.businessProvince].filter(Boolean).join(', ')
  return [cityProvince, business.businessPostalCode].filter(Boolean).join(' ')
}

function formatLocalDate(value: string): string {
  const date = parseUtcTimestamp(value)
  if (!date) return escapeHtml(value)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${day}/${month}/${year}`
}

function formatLocalTime(value: string): string {
  const date = parseUtcTimestamp(value)
  if (!date) return escapeHtml(value)
  const hour = date.getHours()
  const hour12 = hour % 12 || 12
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${hour12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`
}

function parseUtcTimestamp(value: string): Date | null {
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(cents / 100)
}

function formatTaxRate(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2)
}

function tenderLabel(type: string): string {
  if (type === 'card') return 'Card (type unknown)'
  return type.charAt(0).toUpperCase() + type.slice(1)
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
    return entities[character] ?? character
  })
}

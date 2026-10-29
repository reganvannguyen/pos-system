import type { SalesReportTaxTotal, SalesReportTotals, SalesSummaryGroup } from './pos-api'

export const salesSummaryGroups = [
  { value: 'overview', label: 'Overview' },
  { value: 'gross', label: 'Gross' },
  { value: 'returns', label: 'Returns' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'net', label: 'Net' }
] as const satisfies ReadonlyArray<{ value: SalesSummaryGroup; label: string }>

export const optionalSalesSummaryGroups = [
  { value: 'gross', label: 'Gross' },
  { value: 'returns', label: 'Returns' },
  { value: 'cash', label: 'Cash details' },
  { value: 'debit', label: 'Debit details' },
  { value: 'credit', label: 'Credit details' },
  { value: 'etransfer', label: 'E-transfer details' },
  { value: 'check', label: 'Check details' }
] as const satisfies ReadonlyArray<{ value: SalesSummaryGroup; label: string }>

export const recognizedSalesSummaryGroups: ReadonlyArray<{
  value: SalesSummaryGroup
  label: string
}> = [
  ...salesSummaryGroups,
  ...optionalSalesSummaryGroups.filter(
    (group) =>
      group.value === 'debit' ||
      group.value === 'credit' ||
      group.value === 'etransfer' ||
      group.value === 'check'
  )
]

export interface SalesSummaryMetric {
  label: string
  value: number
  kind: 'count' | 'money'
  emphasized?: boolean
}

export interface SalesSummarySection {
  id: 'activity' | 'payments' | 'taxes' | 'additional' | 'net-sales'
  label: string
  metrics: SalesSummaryMetric[]
  emptyMessage?: string
}

export function isSalesSummaryGroup(value: unknown): value is SalesSummaryGroup {
  return (
    typeof value === 'string' && recognizedSalesSummaryGroups.some((group) => group.value === value)
  )
}

export function parseSalesSummaryGroups(value: string | null): SalesSummaryGroup[] {
  if (value === null) return ['overview']

  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed === 'string' && isSalesSummaryGroup(parsed)) return [parsed]
    if (Array.isArray(parsed)) {
      const selected = new Set<unknown>(parsed)
      return recognizedSalesSummaryGroups
        .filter((group) => selected.has(group.value))
        .map((group) => group.value)
    }
  } catch {
    if (isSalesSummaryGroup(value)) return [value]
  }

  return ['overview']
}

export function getSalesSummaryMetrics(
  totals: SalesReportTotals,
  group: SalesSummaryGroup
): SalesSummaryMetric[] {
  switch (group) {
    case 'overview':
      return [
        { label: 'Transactions', value: totals.transactionCount, kind: 'count' },
        { label: 'Sales', value: totals.saleCount, kind: 'count' },
        { label: 'Returns', value: totals.returnCount, kind: 'count' }
      ]
    case 'gross':
      return [
        { label: 'Gross subtotal', value: totals.grossSalesSubtotalCents, kind: 'money' },
        { label: 'Gross tax', value: totals.grossSalesTaxCents, kind: 'money' },
        { label: 'Gross sales', value: totals.grossSalesTotalCents, kind: 'money' }
      ]
    case 'returns':
      return [
        { label: 'Returns subtotal', value: totals.returnsSubtotalCents, kind: 'money' },
        { label: 'Returns tax', value: totals.returnsTaxCents, kind: 'money' },
        { label: 'Returns total', value: totals.returnsTotalCents, kind: 'money' }
      ]
    case 'net':
      return [
        { label: 'Net subtotal', value: totals.netSubtotalCents, kind: 'money' },
        { label: 'Net tax', value: totals.netTaxCents, kind: 'money' },
        { label: 'Net total', value: totals.netTotalCents, kind: 'money', emphasized: true }
      ]
    case 'cash':
      return [
        { label: 'Cash received', value: totals.cashReceivedCents, kind: 'money' },
        {
          label: 'Cash refunded',
          value: totals.cashRefundedCents === 0 ? 0 : -totals.cashRefundedCents,
          kind: 'money'
        },
        { label: 'Cash net', value: totals.cashNetCents, kind: 'money' }
      ]
    case 'card':
      return [
        { label: 'Card received', value: totals.cardReceivedCents, kind: 'money' },
        {
          label: 'Card refunded',
          value: totals.cardRefundedCents === 0 ? 0 : -totals.cardRefundedCents,
          kind: 'money'
        },
        { label: 'Card net', value: totals.cardNetCents, kind: 'money' }
      ]
    case 'debit': {
      const received = totals.debitReceivedCents ?? 0
      const refunded = totals.debitRefundedCents ?? 0
      return [
        { label: 'Debit received', value: received, kind: 'money' },
        { label: 'Debit refunded', value: refunded === 0 ? 0 : -refunded, kind: 'money' },
        { label: 'Debit net', value: totals.debitNetCents ?? received - refunded, kind: 'money' }
      ]
    }
    case 'credit': {
      const received = totals.creditReceivedCents ?? totals.cardReceivedCents ?? 0
      const refunded = totals.creditRefundedCents ?? totals.cardRefundedCents ?? 0
      return [
        { label: 'Credit received', value: received, kind: 'money' },
        { label: 'Credit refunded', value: refunded === 0 ? 0 : -refunded, kind: 'money' },
        { label: 'Credit net', value: totals.creditNetCents ?? received - refunded, kind: 'money' }
      ]
    }
    case 'etransfer':
      return [{ label: 'E-transfer received', value: totals.etransferReceivedCents, kind: 'money' }]
    case 'check':
      return [{ label: 'Check received', value: totals.checkReceivedCents, kind: 'money' }]
  }
}

export function getSalesSummaryMetricsForGroups(
  totals: SalesReportTotals,
  groups: SalesSummaryGroup[]
): SalesSummaryMetric[] {
  return groups.flatMap((group) => getSalesSummaryMetrics(totals, group))
}

export function getSalesReportDisplayMetrics(
  totals: SalesReportTotals,
  optionalGroups: SalesSummaryGroup[],
  taxTotals: SalesReportTaxTotal[] = []
): SalesSummaryMetric[] {
  return getSalesReportDisplaySections(totals, optionalGroups, taxTotals).flatMap(
    (section) => section.metrics
  )
}

export function getSalesReportDisplaySections(
  totals: SalesReportTotals,
  optionalGroups: SalesSummaryGroup[],
  taxTotals: SalesReportTaxTotal[] = []
): SalesSummarySection[] {
  const selectedOptionalGroups = optionalSalesSummaryGroups
    .filter((group) => optionalGroups.includes(group.value))
    .map((group) => group.value)
  const optionalMetrics = selectedOptionalGroups.flatMap((group) => {
    const metrics = getSalesSummaryMetrics(totals, group)
    return group === 'cash' || group === 'debit' || group === 'credit'
      ? metrics.slice(0, 2)
      : metrics
  })

  const sections: SalesSummarySection[] = [
    {
      id: 'activity',
      label: 'Activity',
      metrics: getSalesSummaryMetrics(totals, 'overview')
    },
    {
      id: 'payments',
      label: 'Payments',
      metrics: [
        getSalesSummaryMetrics(totals, 'cash')[2],
        getSalesSummaryMetrics(totals, 'debit')[2],
        getSalesSummaryMetrics(totals, 'credit')[2],
        getSalesSummaryMetrics(totals, 'etransfer')[0],
        getSalesSummaryMetrics(totals, 'check')[0]
      ]
    },
    {
      id: 'taxes',
      label: 'Taxes',
      metrics: taxTotals.map((tax) => ({
        label: tax.taxName,
        value: tax.netTaxCents,
        kind: 'money'
      })),
      ...(taxTotals.length === 0 && { emptyMessage: 'No tax recorded in this period.' })
    }
  ]

  if (optionalMetrics.length > 0) {
    sections.push({ id: 'additional', label: 'Additional summaries', metrics: optionalMetrics })
  }

  sections.push({
    id: 'net-sales',
    label: 'Net sales',
    metrics: getSalesSummaryMetrics(totals, 'net')
  })
  return sections
}

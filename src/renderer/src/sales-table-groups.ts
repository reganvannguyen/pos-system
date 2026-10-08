import type { SaleSummary } from '../../shared/pos-api'

export interface SalesTableDayGroup {
  date: string
  sales: SaleSummary[]
  isDayStart: boolean
  isDayStripeAlternate: boolean
}

export function groupSalesByLocalDay(sales: SaleSummary[]): SalesTableDayGroup[] {
  const groups: SalesTableDayGroup[] = []

  for (const sale of sales) {
    const date = new Date(`${sale.createdAt.replace(' ', 'T')}Z`)
    const pad = (part: number): string => String(part).padStart(2, '0')
    const localDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    const latestGroup = groups[groups.length - 1]

    if (latestGroup?.date === localDate) {
      latestGroup.sales.push(sale)
      continue
    }

    groups.push({
      date: localDate,
      sales: [sale],
      isDayStart: groups.length > 0,
      isDayStripeAlternate: groups.length % 2 === 1
    })
  }

  return groups
}

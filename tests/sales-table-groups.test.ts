import assert from 'node:assert/strict'
import test from 'node:test'
import type { SaleSummary } from '../src/shared/pos-api'
import { groupSalesByLocalDay } from '../src/renderer/src/sales-table-groups'

function sale(id: number, createdAt: string): SaleSummary {
  return {
    id,
    transactionNumber: `20250309-${String(id).padStart(4, '0')}`,
    transactionType: 'sale',
    returnReason: null,
    subtotalCents: 100,
    taxCents: 0,
    totalCents: 100,
    paymentMethod: 'cash',
    chargeAmountCents: null,
    chargeBalanceCents: null,
    payments: [],
    createdAt,
    itemCount: 1,
    customer: null
  }
}

function localSqlTimestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): string {
  const date = new Date(year, month - 1, day, hour, minute)
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

test('groups transactions by local date around midnight and spring DST', () => {
  const previousTimeZone = process.env.TZ
  process.env.TZ = 'America/Vancouver'

  try {
    const groups = groupSalesByLocalDay([
      sale(1, localSqlTimestamp(2025, 3, 10, 0, 15)),
      sale(2, localSqlTimestamp(2025, 3, 9, 23, 30)),
      sale(3, localSqlTimestamp(2025, 3, 9, 0, 15)),
      sale(4, localSqlTimestamp(2025, 3, 8, 23, 50))
    ])

    assert.deepEqual(
      groups.map((group) => group.sales.map((row) => row.id)),
      [[1], [2, 3], [4]]
    )
    assert.deepEqual(
      groups.map((group) => group.date),
      ['2025-03-10', '2025-03-09', '2025-03-08']
    )
    assert.deepEqual(
      groups.map((group) => group.isDayStart),
      [false, true, true]
    )
    assert.deepEqual(
      groups.map((group) => group.isDayStripeAlternate),
      [false, true, false]
    )
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})

test('keeps repeated local times during the fall DST change in one day group', () => {
  const previousTimeZone = process.env.TZ
  process.env.TZ = 'America/Vancouver'

  try {
    const groups = groupSalesByLocalDay([
      sale(1, localSqlTimestamp(2025, 11, 2, 2, 30)),
      sale(2, localSqlTimestamp(2025, 11, 2, 1, 30)),
      sale(3, localSqlTimestamp(2025, 11, 2, 0, 30)),
      sale(4, localSqlTimestamp(2025, 11, 1, 23, 50))
    ])

    assert.deepEqual(
      groups.map(({ date, sales }) => [date, sales.length]),
      [
        ['2025-11-02', 3],
        ['2025-11-01', 1]
      ]
    )
  } finally {
    if (previousTimeZone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimeZone
  }
})

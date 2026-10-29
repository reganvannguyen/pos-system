import assert from 'node:assert/strict'
import test from 'node:test'
import type { SalesReportTotals } from '../src/shared/pos-api'
import {
  getSalesSummaryMetrics,
  getSalesSummaryMetricsForGroups,
  getSalesReportDisplaySections,
  isSalesSummaryGroup,
  parseSalesSummaryGroups,
  salesSummaryGroups
} from '../src/renderer/src/sales-report-summary'

const totals: SalesReportTotals = {
  transactionCount: 4,
  saleCount: 3,
  returnCount: 1,
  grossSalesSubtotalCents: 7996,
  grossSalesTaxCents: 720,
  grossSalesTotalCents: 8716,
  returnsSubtotalCents: -1999,
  returnsTaxCents: -240,
  returnsTotalCents: -2239,
  netSubtotalCents: 5997,
  netTaxCents: 480,
  netTotalCents: 6477,
  cashReceivedCents: 2239,
  cashRefundedCents: 0,
  cashNetCents: 2239,
  cardReceivedCents: 6477,
  cardRefundedCents: 2239,
  cardNetCents: 4238,
  etransferReceivedCents: 350,
  checkReceivedCents: 125
}

test('each sales summary group returns its three report metrics', () => {
  const expectedLabels = [
    ['Transactions', 'Sales', 'Returns'],
    ['Gross subtotal', 'Gross tax', 'Gross sales'],
    ['Returns subtotal', 'Returns tax', 'Returns total'],
    ['Cash received', 'Cash refunded', 'Cash net'],
    ['Card received', 'Card refunded', 'Card net'],
    ['Net subtotal', 'Net tax', 'Net total']
  ]
  const expectedValues = [
    [4, 3, 1],
    [7996, 720, 8716],
    [-1999, -240, -2239],
    [2239, 0, 2239],
    [6477, -2239, 4238],
    [5997, 480, 6477]
  ]

  assert.equal(salesSummaryGroups.length, expectedLabels.length)
  salesSummaryGroups.forEach((group, index) => {
    const metrics = getSalesSummaryMetrics(totals, group.value)
    assert.equal(metrics.length, 3)
    assert.deepEqual(
      metrics.map((metric) => metric.label),
      expectedLabels[index]
    )
    assert.deepEqual(
      metrics.map((metric) => metric.value),
      expectedValues[index]
    )
  })
})

test('returns and refunds keep negative signs, and net total stays emphasized', () => {
  assert.deepEqual(
    getSalesSummaryMetrics(totals, 'returns').map((metric) => metric.value),
    [-1999, -240, -2239]
  )
  assert.equal(getSalesSummaryMetrics(totals, 'cash')[1]?.value, 0)
  assert.equal(getSalesSummaryMetrics(totals, 'card')[1]?.value, -2239)
  assert.equal(getSalesSummaryMetrics(totals, 'net')[2]?.emphasized, true)
})

test('only supported saved values are accepted as a summary group', () => {
  assert.equal(isSalesSummaryGroup('overview'), true)
  assert.equal(isSalesSummaryGroup('card'), true)
  assert.equal(isSalesSummaryGroup('etransfer'), true)
  assert.equal(isSalesSummaryGroup('check'), true)
  assert.equal(isSalesSummaryGroup('unknown'), false)
  assert.equal(isSalesSummaryGroup(null), false)
})

test('selected groups show cards from every selected summary', () => {
  assert.deepEqual(
    getSalesSummaryMetricsForGroups(totals, ['overview', 'cash']).map((metric) => metric.label),
    ['Transactions', 'Sales', 'Returns', 'Cash received', 'Cash refunded', 'Cash net']
  )
  assert.deepEqual(
    getSalesSummaryMetricsForGroups(totals, ['etransfer', 'check']).map(({ label, value }) => [
      label,
      value
    ]),
    [
      ['E-transfer received', 350],
      ['Check received', 125]
    ]
  )
})

test('payment report section keeps e-transfer and check receipts separate', () => {
  const payments = getSalesReportDisplaySections(totals, []).find(
    (section) => section.id === 'payments'
  )
  assert.deepEqual(
    payments?.metrics.map(({ label, value }) => [label, value]),
    [
      ['Cash net', 2239],
      ['Debit net', 0],
      ['Credit net', 4238],
      ['E-transfer received', 350],
      ['Check received', 125]
    ]
  )
})

test('essential sections always include one net tax card per tax before net sales', () => {
  const taxTotals = [
    { taxName: 'GST', salesTaxCents: 500, returnsTaxCents: -100, netTaxCents: 400 },
    { taxName: 'PST', salesTaxCents: 300, returnsTaxCents: -350, netTaxCents: -50 },
    {
      taxName: 'Unitemized tax',
      salesTaxCents: 25,
      returnsTaxCents: 0,
      netTaxCents: 25
    }
  ]

  const sections = getSalesReportDisplaySections(totals, [], taxTotals)
  const taxes = sections.find((section) => section.id === 'taxes')

  assert.deepEqual(
    sections.map((section) => section.id),
    ['activity', 'payments', 'taxes', 'net-sales']
  )
  assert.deepEqual(
    taxes?.metrics.map(({ label, value, kind }) => [label, value, kind]),
    [
      ['GST', 400, 'money'],
      ['PST', -50, 'money'],
      ['Unitemized tax', 25, 'money']
    ]
  )
  assert.equal(taxes?.emptyMessage, undefined)
})

test('Taxes stays visible with an empty message when the period has no tax totals', () => {
  const sections = getSalesReportDisplaySections(totals, ['cash'])
  const taxes = sections.find((section) => section.id === 'taxes')

  assert.deepEqual(
    sections.map((section) => section.id),
    ['activity', 'payments', 'taxes', 'additional', 'net-sales']
  )
  assert.deepEqual(taxes?.metrics, [])
  assert.equal(taxes?.emptyMessage, 'No tax recorded in this period.')
  assert.deepEqual(
    sections.find((section) => section.id === 'additional')?.metrics.map(({ label }) => label),
    ['Cash received', 'Cash refunded']
  )
})

test('saved summary selections support defaults, multiple groups, and old single-group values', () => {
  assert.deepEqual(parseSalesSummaryGroups(null), ['overview'])
  assert.deepEqual(parseSalesSummaryGroups('net'), ['net'])
  assert.deepEqual(parseSalesSummaryGroups(JSON.stringify(['card', 'gross', 'card', 'invalid'])), [
    'gross',
    'card'
  ])
  assert.deepEqual(parseSalesSummaryGroups('[]'), [])
  assert.deepEqual(parseSalesSummaryGroups('invalid'), ['overview'])
})

import { Fragment, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type {
  DailyProductSummary,
  SaleDetail,
  SaleSummary,
  SalesPeriod,
  SalesPdfReportType,
  SalesReport,
  ChargePaymentTenderType
} from '../../shared/pos-api'
import { centsInput, parseCadCents, tenderLabel } from './checkout'
import {
  getSalesReportDisplaySections,
  optionalSalesSummaryGroups,
  parseSalesSummaryGroups,
  type SalesSummaryGroup
} from './sales-report-summary'
import { groupSalesByLocalDay } from './sales-table-groups'
import ReceiptDialog from './ReceiptDialog'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short'
})
const summaryGroupsStorageKey = 'pos.sales-summary-groups'
const legacySummaryGroupStorageKey = 'pos.sales-summary-group'
const salesPeriodStorageKey = 'pos.sales-period'

function readSavedSummaryGroups(): SalesSummaryGroup[] {
  let saved: SalesSummaryGroup[]
  try {
    const savedGroups = window.localStorage.getItem(summaryGroupsStorageKey)
    saved =
      savedGroups !== null
        ? parseSalesSummaryGroups(savedGroups)
        : parseSalesSummaryGroups(window.localStorage.getItem(legacySummaryGroupStorageKey))
  } catch {
    return []
  }
  if (saved.includes('card')) {
    saved = [...saved.filter((group) => group !== 'card'), 'debit', 'credit']
  }
  return optionalSalesSummaryGroups
    .filter((group) => saved.includes(group.value))
    .map((group) => group.value)
}

function summaryPickerText(selectedGroups: SalesSummaryGroup[]): string {
  if (selectedGroups.length === 0) return 'Add summaries'
  const labels = optionalSalesSummaryGroups
    .filter((group) => selectedGroups.includes(group.value))
    .map((group) => group.label)
  if (labels.length <= 2) return labels.join(', ')
  return `${labels.length} summaries selected`
}

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value.replace(' ', 'T')}Z`))
}

function formatLocalDay(value: string): string {
  return new Intl.DateTimeFormat('en-CA', { dateStyle: 'full' }).format(
    new Date(`${value}T00:00:00`)
  )
}

function toLocalDateInput(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function isDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined || year < 1000) return false
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function isSalesPeriod(value: unknown): value is SalesPeriod {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const period = value as Record<string, unknown>
  switch (period.type) {
    case 'day':
    case 'week':
      return isDateInput(period.date)
    case 'month':
      return (
        typeof period.month === 'string' &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month) &&
        Number(period.month.slice(0, 4)) >= 1000
      )
    case 'year':
      return (
        Number.isInteger(period.year) && Number(period.year) >= 1000 && Number(period.year) <= 9999
      )
    case 'custom':
      return (
        isDateInput(period.startDate) &&
        isDateInput(period.endDate) &&
        period.startDate <= period.endDate
      )
    default:
      return false
  }
}

function readSavedSalesPeriod(): SalesPeriod {
  try {
    const saved = window.localStorage.getItem(salesPeriodStorageKey)
    if (saved !== null) {
      const parsed: unknown = JSON.parse(saved)
      if (isSalesPeriod(parsed)) return parsed
    }
  } catch {
    // Fall back to the current local day when browser storage is unavailable or invalid.
  }
  return { type: 'day', date: toLocalDateInput(new Date()) }
}

function mondayOfWeek(value: string): string {
  if (!value) return value
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return toLocalDateInput(date)
}

function periodAnchorDate(period: SalesPeriod): string {
  switch (period.type) {
    case 'day':
    case 'week':
      return period.date
    case 'month':
      return `${period.month}-01`
    case 'year':
      return `${period.year}-01-01`
    case 'custom':
      return period.startDate
  }
}

function changePeriodType(period: SalesPeriod, type: SalesPeriod['type']): SalesPeriod {
  const anchorDate = periodAnchorDate(period)
  const today = toLocalDateInput(new Date())
  switch (type) {
    case 'day':
      return { type, date: today }
    case 'week':
      return { type, date: mondayOfWeek(today) }
    case 'month':
      return { type, month: today.slice(0, 7) }
    case 'year':
      return { type, year: new Date().getFullYear() }
    case 'custom':
      return { type, startDate: anchorDate, endDate: anchorDate }
  }
}

function SalesScreen(): React.JSX.Element {
  const [summaryGroups, setSummaryGroups] = useState<SalesSummaryGroup[]>(readSavedSummaryGroups)
  const [summaryMenuOpen, setSummaryMenuOpen] = useState(false)
  const summaryPickerRef = useRef<HTMLDivElement>(null)
  const summaryTriggerRef = useRef<HTMLButtonElement>(null)
  const [period, setPeriod] = useState<SalesPeriod>(readSavedSalesPeriod)
  const [report, setReport] = useState<SalesReport | null>(null)
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [expandedProductDays, setExpandedProductDays] = useState<Record<string, boolean>>({})
  const [dailyProducts, setDailyProducts] = useState<Record<string, DailyProductSummary[]>>({})
  const [loadingDailyProducts, setLoadingDailyProducts] = useState<Record<string, boolean>>({})
  const [dailyProductErrors, setDailyProductErrors] = useState<Record<string, string>>({})
  const [exportFormat, setExportFormat] = useState<null | 'csv' | 'pdf'>(null)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [exportError, setExportError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    try {
      window.localStorage.setItem(summaryGroupsStorageKey, JSON.stringify(summaryGroups))
    } catch {
      // Keep the current selection for this visit if browser storage is unavailable.
    }
  }, [summaryGroups])

  useEffect(() => {
    try {
      window.localStorage.setItem(salesPeriodStorageKey, JSON.stringify(period))
    } catch {
      // Keep the current period for this visit if browser storage is unavailable.
    }
  }, [period])

  useEffect(() => {
    if (!summaryMenuOpen) return

    function closeOnOutsidePointer(event: PointerEvent): void {
      if (event.target instanceof Node && !summaryPickerRef.current?.contains(event.target)) {
        setSummaryMenuOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setSummaryMenuOpen(false)
        summaryTriggerRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [summaryMenuOpen])

  useEffect(() => {
    let current = true

    void window.pos.sales
      .report(period)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setReport(result.data)
        } else {
          setError(result.error.message)
        }
      })
      .catch(() => {
        if (current) setError('The sales report could not be loaded. Try again.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [period, reloadKey])

  async function openSale(sale: SaleSummary): Promise<void> {
    setLoadingDetail(true)
    setDetailError('')
    try {
      const result = await window.pos.sales.getById(sale.id)
      if (result.ok) setSelectedSale(result.data)
      else setDetailError(result.error.message)
    } catch {
      setDetailError('Transaction details could not be loaded. Try again.')
    } finally {
      setLoadingDetail(false)
    }
  }

  function updateSelectedSale(sale: SaleDetail): void {
    setSelectedSale(sale)
    setReloadKey((key) => key + 1)
  }

  async function loadDailyProducts(date: string, retry = false): Promise<void> {
    if (loadingDailyProducts[date] || (!retry && dailyProducts[date] !== undefined)) return
    setLoadingDailyProducts((previous) => ({ ...previous, [date]: true }))
    setDailyProductErrors((previous) => ({ ...previous, [date]: '' }))
    try {
      const result = await window.pos.sales.productsForDay(date)
      if (result.ok) setDailyProducts((previous) => ({ ...previous, [date]: result.data }))
      else setDailyProductErrors((previous) => ({ ...previous, [date]: result.error.message }))
    } catch {
      setDailyProductErrors((previous) => ({
        ...previous,
        [date]: 'The daily product summary could not be loaded. Try again.'
      }))
    } finally {
      setLoadingDailyProducts((previous) => ({ ...previous, [date]: false }))
    }
  }

  function toggleDailyProducts(date: string): void {
    const willExpand = !expandedProductDays[date]
    setExpandedProductDays((previous) => ({ ...previous, [date]: willExpand }))
    if (willExpand) void loadDailyProducts(date)
  }

  async function exportCsv(): Promise<void> {
    if (exportFormat || !report) return
    setExportFormat('csv')
    try {
      const result = await window.pos.sales.exportCsv(period)
      if (!result.ok) {
        setExportStatus(result.error.message)
        setExportError(true)
      } else if (!result.data.canceled) {
        setExportStatus(
          `Exported a CSV report with ${result.data.rowCount} transactions and tender totals.`
        )
        setExportError(false)
      }
    } catch {
      setExportStatus('The CSV could not be saved. Choose another location and try again.')
      setExportError(true)
    } finally {
      setExportFormat(null)
    }
  }

  async function exportPdf(reportType: SalesPdfReportType): Promise<void> {
    if (exportFormat || !report) return
    setExportFormat('pdf')
    try {
      const result = await window.pos.sales.exportPdf(period, summaryGroups, reportType)
      if (!result.ok) {
        setExportStatus(result.error.message)
        setExportError(true)
      } else if (!result.data.canceled) {
        const noun = result.data.rowCount === 1 ? 'transaction' : 'transactions'
        setExportStatus(`Exported a PDF report with ${result.data.rowCount} ${noun}.`)
        setExportError(false)
      }
    } catch {
      setExportStatus(
        'The PDF report could not be created or saved. Choose another location and try again.'
      )
      setExportError(true)
    } finally {
      setExportFormat(null)
    }
  }

  function updatePeriod(next: SalesPeriod): void {
    setLoading(true)
    setReport(null)
    setError('')
    setExportStatus('')
    setExportError(false)
    setPeriod(next)
  }

  function reload(): void {
    setLoading(true)
    setReport(null)
    setError('')
    setReloadKey((key) => key + 1)
  }

  return (
    <section className="sales-page" aria-label="Sales history">
      {selectedSale ? (
        <SaleDetailView
          sale={selectedSale}
          onBack={() => setSelectedSale(null)}
          onUpdated={updateSelectedSale}
        />
      ) : (
        <>
          <div className="sales-report-toolbar">
            <div className="sales-period-controls">
              <label className="sales-period-type">
                <span>Period</span>
                <select
                  value={period.type}
                  onChange={(event) =>
                    updatePeriod(
                      changePeriodType(period, event.target.value as SalesPeriod['type'])
                    )
                  }
                >
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                  <option value="year">Year</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {period.type === 'day' ? (
                <label>
                  <span>Sales date</span>
                  <input
                    type="date"
                    value={period.date}
                    onChange={(event) => updatePeriod({ type: 'day', date: event.target.value })}
                  />
                </label>
              ) : period.type === 'week' ? (
                <label>
                  <span>Week starting</span>
                  <input
                    type="date"
                    value={period.date}
                    onChange={(event) =>
                      updatePeriod({ type: 'week', date: mondayOfWeek(event.target.value) })
                    }
                  />
                </label>
              ) : period.type === 'month' ? (
                <label>
                  <span>Sales month</span>
                  <input
                    type="month"
                    value={period.month}
                    onChange={(event) => updatePeriod({ type: 'month', month: event.target.value })}
                  />
                </label>
              ) : period.type === 'year' ? (
                <label>
                  <span>Sales year</span>
                  <input
                    type="number"
                    min="1000"
                    max="9999"
                    step="1"
                    value={period.year}
                    onChange={(event) =>
                      updatePeriod({
                        type: 'year',
                        year: event.target.value === '' ? 0 : Number(event.target.value)
                      })
                    }
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span>From</span>
                    <input
                      type="date"
                      value={period.startDate}
                      onChange={(event) =>
                        updatePeriod({ ...period, startDate: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Through</span>
                    <input
                      type="date"
                      value={period.endDate}
                      onChange={(event) => updatePeriod({ ...period, endDate: event.target.value })}
                    />
                  </label>
                </>
              )}
              <div className="sales-summary-picker" ref={summaryPickerRef}>
                <span className="sales-summary-picker-label">Optional summaries</span>
                <button
                  ref={summaryTriggerRef}
                  className="sales-summary-picker-trigger"
                  type="button"
                  aria-label={`Summary groups: ${summaryPickerText(summaryGroups)}`}
                  aria-expanded={summaryMenuOpen}
                  onClick={() => setSummaryMenuOpen((open) => !open)}
                >
                  <span>{summaryPickerText(summaryGroups)}</span>
                  <span className="sales-summary-picker-chevron" aria-hidden="true">
                    {summaryMenuOpen ? '⌃' : '⌄'}
                  </span>
                </button>
                {summaryMenuOpen && (
                  <div
                    className="sales-summary-picker-menu"
                    role="group"
                    aria-label="Summary groups"
                  >
                    {optionalSalesSummaryGroups.map((group) => (
                      <label className="sales-summary-picker-option" key={group.value}>
                        <input
                          type="checkbox"
                          checked={summaryGroups.includes(group.value)}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked
                            setSummaryGroups((current) => {
                              const selected = new Set(current)
                              if (checked) selected.add(group.value)
                              else selected.delete(group.value)
                              return optionalSalesSummaryGroups
                                .filter((option) => selected.has(option.value))
                                .map((option) => option.value)
                            })
                          }}
                        />
                        <span>{group.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="sales-export-actions">
              <button
                className="primary-button sales-export-button"
                type="button"
                disabled={loading || !report || exportFormat !== null}
                onClick={() => void exportCsv()}
              >
                {exportFormat === 'csv' ? 'Exporting…' : 'Export CSV'}
              </button>
              <button
                className="secondary-button sales-export-button"
                type="button"
                disabled={loading || !report || exportFormat !== null}
                onClick={() => setReportDialogOpen(true)}
              >
                {exportFormat === 'pdf' ? 'Preparing PDF…' : 'Generate report'}
              </button>
            </div>
          </div>

          {exportStatus && (
            <p
              className={exportError ? 'sales-export-message is-error' : 'sales-export-message'}
              role={exportError ? 'alert' : 'status'}
            >
              {exportStatus}
            </p>
          )}

          {report && !loading && (
            <>
              <div
                className="sales-report-summary"
                aria-label={`Transactions, sales, returns, cash net, debit net, credit net, e-transfer received, check received, net subtotal, net tax, and net total${summaryGroups.length ? `, plus ${summaryPickerText(summaryGroups)}` : ''}`}
              >
                {getSalesReportDisplaySections(report.totals, summaryGroups).map((section) => (
                  <section
                    className={`sales-summary-section sales-summary-section--${section.id}`}
                    aria-labelledby={`sales-summary-${section.id}`}
                    key={section.id}
                  >
                    <h2 className="sales-summary-heading" id={`sales-summary-${section.id}`}>
                      {section.label}
                    </h2>
                    <div className="sales-report-summary-grid">
                      {section.metrics.map((metric) => (
                        <ReportMetric
                          key={metric.label}
                          label={metric.label}
                          value={
                            metric.kind === 'money' ? money(metric.value) : String(metric.value)
                          }
                          emphasized={metric.emphasized}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <p className="sales-report-count" role="status">
                Showing {report.totals.transactionCount}{' '}
                {report.totals.transactionCount === 1 ? 'transaction' : 'transactions'} in the
                selected period
              </p>
            </>
          )}

          <div className="sales-table-card">
            {loading ? (
              <div className="sales-state" role="status">
                Loading transactions…
              </div>
            ) : error ? (
              <div className="sales-state sales-error-state" role="alert">
                <p>{error}</p>
                <button className="secondary-button" type="button" onClick={reload}>
                  Retry
                </button>
              </div>
            ) : !report || report.sales.length === 0 ? (
              <div className="sales-state">
                <div className="empty-product-mark" aria-hidden="true">
                  $
                </div>
                <h2>No transactions in this period</h2>
                <p>Try another day or date range.</p>
              </div>
            ) : (
              <>
                <div className="sales-table-scroll">
                  <table className="sales-table">
                    <thead>
                      <tr>
                        <th scope="col">Transaction #</th>
                        <th scope="col">Date</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Items</th>
                        <th scope="col">Total</th>
                        <th scope="col">
                          <span className="visually-hidden">Open sale</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {groupSalesByLocalDay(report.sales).map((day) => {
                        const expanded = Boolean(expandedProductDays[day.date])
                        const dailyProductsId = `sales-products-${day.date}`
                        const dayStripeClass = day.isDayStripeAlternate
                          ? 'has-day-stripe has-alternate-day-stripe'
                          : 'has-day-stripe'

                        return (
                          <Fragment key={day.date}>
                            <tr
                              className={[
                                'sales-day-heading',
                                day.isDayStart ? 'is-day-start' : '',
                                dayStripeClass
                              ]
                                .filter(Boolean)
                                .join(' ')}
                            >
                              <td colSpan={6}>
                                <button
                                  className="sales-day-products-toggle"
                                  type="button"
                                  aria-expanded={expanded}
                                  aria-controls={dailyProductsId}
                                  aria-label={`${expanded ? 'Hide' : 'Show'} products for ${formatLocalDay(day.date)}`}
                                  onClick={() => toggleDailyProducts(day.date)}
                                >
                                  <time className="sales-day-label" dateTime={day.date}>
                                    {formatLocalDay(day.date)}
                                  </time>
                                  <span className="sales-day-products-action">
                                    {expanded ? 'Hide products' : 'Products'}
                                  </span>
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr
                                className={`sales-day-products ${dayStripeClass}`}
                                id={dailyProductsId}
                                aria-busy={Boolean(loadingDailyProducts[day.date])}
                              >
                                <td colSpan={6}>
                                  {loadingDailyProducts[day.date] ? (
                                    <p className="daily-products-state" role="status">
                                      Loading products for {formatLocalDay(day.date)}…
                                    </p>
                                  ) : dailyProductErrors[day.date] ? (
                                    <div className="daily-products-error" role="alert">
                                      <span>{dailyProductErrors[day.date]}</span>
                                      <button
                                        className="text-button"
                                        type="button"
                                        onClick={() => void loadDailyProducts(day.date, true)}
                                      >
                                        Retry
                                      </button>
                                    </div>
                                  ) : dailyProducts[day.date]?.length ? (
                                    <table className="daily-products-table">
                                      <caption className="visually-hidden">
                                        Products sold or returned on {formatLocalDay(day.date)}
                                      </caption>
                                      <thead>
                                        <tr>
                                          <th scope="col">Product</th>
                                          <th scope="col">SKU</th>
                                          <th scope="col">Net quantity</th>
                                          <th scope="col">Net amount (before tax)</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {dailyProducts[day.date]!.map((product) => (
                                          <tr
                                            key={
                                              product.productId ?? `${product.sku}:${product.name}`
                                            }
                                          >
                                            <td>{product.name}</td>
                                            <td>{product.sku}</td>
                                            <td>{product.netQuantity}</td>
                                            <td>
                                              {currencyFormatter.format(
                                                product.netAmountCents / 100
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <p className="daily-products-state">
                                      No item details are available for this day.
                                    </p>
                                  )}
                                </td>
                              </tr>
                            )}
                            {day.sales.map((sale) => (
                              <tr
                                className={[
                                  sale.transactionType === 'return' ? 'is-return' : '',
                                  dayStripeClass
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                key={sale.id}
                              >
                                <td className="sale-number">{sale.transactionNumber}</td>
                                <td>{formatDate(sale.createdAt)}</td>
                                <td className="payment-method">{formatPaymentMethod(sale)}</td>
                                <td>{sale.itemCount}</td>
                                <td className="sale-total">
                                  {currencyFormatter.format(sale.totalCents / 100)}
                                </td>
                                <td className="sale-open-cell">
                                  <button
                                    className="text-button"
                                    type="button"
                                    disabled={loadingDetail}
                                    onClick={() => void openSale(sale)}
                                  >
                                    View
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {loadingDetail && (
                  <p className="sales-loading-detail" role="status">
                    Loading transaction details…
                  </p>
                )}
                {detailError && (
                  <p className="product-banner-error sales-inline-error" role="alert">
                    {detailError}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {reportDialogOpen && (
        <SalesReportTypeDialog
          onCancel={() => setReportDialogOpen(false)}
          onSelect={(reportType) => {
            setReportDialogOpen(false)
            void exportPdf(reportType)
          }}
        />
      )}
    </section>
  )
}

interface SalesReportTypeDialogProps {
  onCancel: () => void
  onSelect: (reportType: SalesPdfReportType) => void
}

function SalesReportTypeDialog({
  onCancel,
  onSelect
}: SalesReportTypeDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  return (
    <dialog
      className="product-dialog sales-report-type-dialog"
      ref={dialogRef}
      aria-labelledby="sales-report-type-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">PDF report</p>
          <h2 id="sales-report-type-title">Choose a report type</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Close report options"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <div className="sales-report-type-options">
        <button type="button" className="secondary-button" onClick={() => onSelect('summary')}>
          <strong>Summary sales</strong>
          <span>Totals, payment methods, tax breakdown, and item totals.</span>
        </button>
        <button type="button" className="secondary-button" onClick={() => onSelect('itemized')}>
          <strong>Itemized</strong>
          <span>The same summary plus every sale and return.</span>
        </button>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}

interface ReportMetricProps {
  label: string
  value: string
  emphasized?: boolean
}

function ReportMetric({ label, value, emphasized = false }: ReportMetricProps): React.JSX.Element {
  const isReturnMetric = label === 'Returns' || label.startsWith('Returns ')
  const isNetTotal = label === 'Net total'
  const classNames = [
    'sales-report-metric',
    emphasized ? 'is-emphasized' : '',
    isReturnMetric ? 'is-return' : '',
    isNetTotal ? 'is-net-total' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classNames}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function money(cents: number): string {
  return currencyFormatter.format(cents / 100)
}

interface SaleDetailViewProps {
  sale: SaleDetail
  onBack: () => void
  onUpdated: (sale: SaleDetail) => void
}

function SaleDetailView({ sale, onBack, onUpdated }: SaleDetailViewProps): React.JSX.Element {
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false)
  const [chargePaymentOpen, setChargePaymentOpen] = useState(false)

  return (
    <div className={`sale-detail-card${sale.transactionType === 'return' ? ' is-return' : ''}`}>
      <div className="sale-detail-heading">
        <button className="secondary-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Sales history
        </button>
        <div>
          <p className="eyebrow">
            {sale.transactionType === 'return' ? 'Completed return' : 'Completed sale'}
          </p>
          <h2>
            {sale.transactionType === 'return' ? 'Return' : 'Invoice'} #{sale.transactionNumber}
          </h2>
          <p className="sale-detail-date">{formatDate(sale.createdAt)}</p>
        </div>
        <span className="payment-badge">{formatPaymentMethod(sale)}</span>
      </div>

      <div className="sale-detail-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() => setReceiptDialogOpen(true)}
        >
          Receipt options
        </button>
        {sale.charge && sale.charge.balanceCents > 0 && (
          <button
            className="primary-button"
            type="button"
            onClick={() => setChargePaymentOpen(true)}
          >
            Record payment
          </button>
        )}
      </div>

      {receiptDialogOpen && (
        <ReceiptDialog sale={sale} onClose={() => setReceiptDialogOpen(false)} />
      )}
      {chargePaymentOpen && sale.charge && (
        <ChargePaymentDialog
          sale={sale}
          onCancel={() => setChargePaymentOpen(false)}
          onUpdated={(updatedSale) => {
            setChargePaymentOpen(false)
            onUpdated(updatedSale)
          }}
        />
      )}

      {sale.charge && (
        <section className="sale-charge-details" aria-label="Charge details">
          <div className="sale-charge-heading">
            <div>
              <p className="eyebrow">Charged to</p>
              <h3>{sale.charge.customer.name}</h3>
            </div>
            <strong className={sale.charge.balanceCents > 0 ? 'charge-balance-due' : 'charge-paid'}>
              {sale.charge.balanceCents > 0
                ? `${currencyFormatter.format(sale.charge.balanceCents / 100)} due`
                : 'Paid in full'}
            </strong>
          </div>
          <dl className="sale-charge-customer">
            {sale.charge.customer.companyName && (
              <div>
                <dt>Company</dt>
                <dd>{sale.charge.customer.companyName}</dd>
              </div>
            )}
            {sale.charge.customer.address && (
              <div>
                <dt>Address</dt>
                <dd>{sale.charge.customer.address}</dd>
              </div>
            )}
            {sale.charge.customer.phoneNumber && (
              <div>
                <dt>Phone</dt>
                <dd>{sale.charge.customer.phoneNumber}</dd>
              </div>
            )}
            {sale.charge.customer.email && (
              <div>
                <dt>Email</dt>
                <dd>{sale.charge.customer.email}</dd>
              </div>
            )}
          </dl>
          <div className="sale-charge-totals">
            <span>Amount charged {currencyFormatter.format(sale.charge.amountCents / 100)}</span>
            <span>Balance due {currencyFormatter.format(sale.charge.balanceCents / 100)}</span>
          </div>
          {sale.charge.payments.length > 0 && (
            <>
              <h4>Repayments</h4>
              <ul className="charge-payment-history">
                {sale.charge.payments.map((payment, index) => (
                  <li key={`${payment.createdAt}-${payment.type}-${index}`}>
                    <span>
                      {formatDate(payment.createdAt)} · {tenderLabel(payment.type)}
                    </span>
                    <strong>{currencyFormatter.format(payment.amountCents / 100)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {sale.transactionType === 'return' && (
        <div className="return-reason-note">
          <strong>Return reason</strong>
          <span>{sale.returnReason}</span>
        </div>
      )}

      <div className="sale-item-table-scroll">
        <table className="sale-item-table">
          <thead>
            <tr>
              <th scope="col">SKU</th>
              <th scope="col">Product</th>
              <th scope="col">Unit price</th>
              <th scope="col">Quantity</th>
              <th scope="col">Line total</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((item, index) => (
              <tr key={`${item.productId ?? 'removed'}-${index}`}>
                <td className="product-sku">{item.sku}</td>
                <td className="product-name-cell">
                  {item.name}
                  {item.priceOverrideReason && (
                    <small className="price-override-reason">
                      Price changed from{' '}
                      {currencyFormatter.format(item.originalUnitPriceCents / 100)} ·{' '}
                      {item.priceOverrideReason}
                    </small>
                  )}
                  {sale.transactionType === 'return' && (
                    <small className="return-restock-status">
                      {item.restockedQuantity > 0
                        ? `Restocked ${item.restockedQuantity}`
                        : item.restockRequested
                          ? 'Restock selected · stock untracked'
                          : 'Not restocked'}
                    </small>
                  )}
                </td>
                <td>
                  {item.priceOverrideReason &&
                  item.originalUnitPriceCents !== item.unitPriceCents ? (
                    <>
                      <del>{currencyFormatter.format(item.originalUnitPriceCents / 100)}</del>{' '}
                      <strong>{currencyFormatter.format(item.unitPriceCents / 100)}</strong>
                    </>
                  ) : (
                    currencyFormatter.format(item.unitPriceCents / 100)
                  )}
                </td>
                <td>{item.quantity}</td>
                <td className="sale-total">
                  {currencyFormatter.format(item.lineTotalCents / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="sale-payment-breakdown" aria-label="Payment details">
        <h3>{sale.transactionType === 'return' ? 'Refund payouts' : 'Payments'}</h3>
        {sale.payments.length === 0 ? (
          <p>
            {sale.transactionType === 'return'
              ? 'No refund payout was required.'
              : sale.charge
                ? 'No money was received at checkout.'
                : 'No payment was required.'}
          </p>
        ) : (
          <ul>
            {sale.payments.map((payment, index) => (
              <li key={`${payment.type}-${index}`}>
                <span>
                  <strong>{tenderLabel(payment.type)}</strong>
                </span>
                {sale.transactionType === 'return' ? (
                  <span>Refunded {currencyFormatter.format(payment.amountAppliedCents / 100)}</span>
                ) : (
                  <>
                    <span>
                      Tendered{' '}
                      {payment.amountTenderedCents === null
                        ? 'unknown'
                        : currencyFormatter.format(payment.amountTenderedCents / 100)}
                    </span>
                    <span>
                      Applied {currencyFormatter.format(payment.amountAppliedCents / 100)}
                    </span>
                  </>
                )}
                {payment.changeCents > 0 && (
                  <span>Change {currencyFormatter.format(payment.changeCents / 100)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sale-detail-footer">
        <dl className="sale-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{currencyFormatter.format(sale.subtotalCents / 100)}</dd>
          </div>
          {sale.taxBreakdown.length > 0 ? (
            <>
              {sale.taxBreakdown.map((tax, index) => (
                <div key={`${tax.name}-${tax.rateBasisPoints}-${index}`}>
                  <dt>
                    {tax.name} ({(tax.rateBasisPoints / 100).toFixed(2)}%)
                  </dt>
                  <dd>{currencyFormatter.format(tax.taxCents / 100)}</dd>
                </div>
              ))}
              <div>
                <dt>Tax total</dt>
                <dd>{currencyFormatter.format(sale.taxCents / 100)}</dd>
              </div>
            </>
          ) : (
            <div>
              <dt>Tax</dt>
              <dd>{currencyFormatter.format(sale.taxCents / 100)}</dd>
            </div>
          )}
          <div className="sale-total-row">
            <dt>Total</dt>
            <dd>{currencyFormatter.format(sale.totalCents / 100)}</dd>
          </div>
          <div>
            <dt>{sale.transactionType === 'return' ? 'Refund method' : 'Payment'}</dt>
            <dd className="payment-method">{formatPaymentMethod(sale)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

interface ChargePaymentDialogProps {
  sale: SaleDetail
  onCancel: () => void
  onUpdated: (sale: SaleDetail) => void
}

function ChargePaymentDialog({
  sale,
  onCancel,
  onUpdated
}: ChargePaymentDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [type, setType] = useState<ChargePaymentTenderType>('cash')
  const [amount, setAmount] = useState(centsInput(sale.charge?.balanceCents ?? 0))
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const remainingCents = sale.charge?.balanceCents ?? 0

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (working) return
    const amountCents = parseCadCents(amount)
    if (amountCents === null || amountCents <= 0) {
      setError('Enter a payment above $0.00 with up to two decimal places.')
      return
    }
    if (amountCents > remainingCents) {
      setError('The payment cannot be greater than the outstanding balance.')
      return
    }
    setWorking(true)
    setError('')
    try {
      const result = await window.pos.sales.recordChargePayment({
        saleId: sale.id,
        type,
        amountCents
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onUpdated(result.data)
    } catch {
      setError('The payment could not be recorded. Try again.')
    } finally {
      setWorking(false)
    }
  }

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="charge-payment-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!working) onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Balance due {currencyFormatter.format(remainingCents / 100)}</p>
          <h2 id="charge-payment-title">Record customer payment</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Cancel payment entry"
          disabled={working}
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="checkout-confirmation price-override-fields">
          <label>
            <span>Payment method</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ChargePaymentTenderType)}
            >
              <option value="cash">Cash</option>
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
              <option value="etransfer">E-transfer</option>
              <option value="check">Check</option>
            </select>
          </label>
          <label>
            <span>Amount received (CAD)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {error && (
            <p className="product-banner-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-actions checkout-dialog-actions">
          <button className="secondary-button" type="button" disabled={working} onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={working}>
            {working ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function formatPaymentMethod(sale: Pick<SaleSummary, 'paymentMethod' | 'payments'>): string {
  if (sale.paymentMethod === 'split') return 'Split'
  if (sale.paymentMethod === 'charge') return 'Charge'
  if (sale.paymentMethod === 'none') return 'No payment'
  if (sale.paymentMethod === 'cash') return 'Cash'

  const tenderTypes = new Set(sale.payments.map((payment) => payment.type))
  if (tenderTypes.size > 1) return 'Split'
  if (tenderTypes.has('debit')) return 'Debit'
  if (tenderTypes.has('cash')) return 'Cash'
  return 'Credit'
}

export default SalesScreen

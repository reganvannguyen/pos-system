import { useEffect, useState } from 'react'
import type { SaleDetail, SaleSummary } from '../../shared/pos-api'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  dateStyle: 'medium',
  timeStyle: 'short'
})

function formatDate(value: string): string {
  return dateFormatter.format(new Date(`${value.replace(' ', 'T')}Z`))
}

function SalesScreen(): React.JSX.Element {
  const [sales, setSales] = useState<SaleSummary[]>([])
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let current = true

    void window.pos.sales
      .listRecent()
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setSales(result.data)
          setError('')
        } else {
          setError(result.error.message)
        }
      })
      .catch(() => {
        if (current) setError('Sales could not be loaded. Try again.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [reloadKey])

  async function openSale(sale: SaleSummary): Promise<void> {
    setLoadingDetail(true)
    setError('')
    try {
      const result = await window.pos.sales.getById(sale.id)
      if (result.ok) setSelectedSale(result.data)
      else setError(result.error.message)
    } catch {
      setError('Sale details could not be loaded. Try again.')
    } finally {
      setLoadingDetail(false)
    }
  }

  function reload(): void {
    setLoading(true)
    setError('')
    setReloadKey((key) => key + 1)
  }

  return (
    <section className="sales-page" aria-label="Sales history">
      {selectedSale ? (
        <SaleDetailView sale={selectedSale} onBack={() => setSelectedSale(null)} />
      ) : loading ? (
        <div className="sales-table-card sales-state" role="status">
          Loading sales…
        </div>
      ) : error ? (
        <div className="sales-table-card sales-state sales-error-state" role="alert">
          <p>{error}</p>
          <button className="secondary-button" type="button" onClick={reload}>
            Retry
          </button>
        </div>
      ) : sales.length === 0 ? (
        <div className="sales-table-card sales-state">
          <div className="empty-product-mark" aria-hidden="true">
            $
          </div>
          <h2>No completed sales</h2>
          <p>Completed sales will appear here.</p>
        </div>
      ) : (
        <div className="sales-table-card">
          <div className="sales-table-scroll">
            <table className="sales-table">
              <thead>
                <tr>
                  <th scope="col">Sale #</th>
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
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="sale-number">#{sale.id}</td>
                    <td>{formatDate(sale.createdAt)}</td>
                    <td className="payment-method">{sale.paymentMethod}</td>
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
              </tbody>
            </table>
          </div>
          <p className="product-count">Showing the 100 most recent sales</p>
          {loadingDetail && (
            <p className="sales-loading-detail" role="status">
              Loading sale details…
            </p>
          )}
          {error && (
            <p className="product-banner-error sales-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

interface SaleDetailViewProps {
  sale: SaleDetail
  onBack: () => void
}

function SaleDetailView({ sale, onBack }: SaleDetailViewProps): React.JSX.Element {
  const [printing, setPrinting] = useState(false)
  const [printed, setPrinted] = useState(false)
  const [printError, setPrintError] = useState('')

  async function printReceipt(): Promise<void> {
    if (printing) return
    setPrinting(true)
    setPrintError('')
    try {
      const result = await window.pos.receipts.print(sale.id)
      if (!result.ok) {
        setPrintError(result.error.message)
        setPrinted(false)
      } else {
        setPrinted(true)
      }
    } catch {
      setPrintError(
        'Receipt could not be sent to the printer. The sale is saved and can be reprinted.'
      )
      setPrinted(false)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="sale-detail-card">
      <div className="sale-detail-heading">
        <button className="secondary-button" type="button" onClick={onBack}>
          <span aria-hidden="true">←</span> Sales history
        </button>
        <div>
          <p className="eyebrow">Completed sale</p>
          <h2>Sale #{sale.id}</h2>
          <p className="sale-detail-date">{formatDate(sale.createdAt)}</p>
        </div>
        <span className="payment-badge">{sale.paymentMethod}</span>
      </div>

      <div className="sale-detail-actions">
        <button
          className="secondary-button"
          type="button"
          disabled={printing}
          onClick={() => void printReceipt()}
        >
          {printing ? 'Sending…' : printed ? 'Reprint receipt' : 'Print receipt'}
        </button>
        {printing && <span role="status">Sending receipt to printer…</span>}
        {printed && !printing && <span role="status">Receipt sent to printer.</span>}
        {printError && (
          <span className="sale-receipt-error" role="alert">
            {printError}
          </span>
        )}
      </div>

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
                <td className="product-name-cell">{item.name}</td>
                <td>{currencyFormatter.format(item.unitPriceCents / 100)}</td>
                <td>{item.quantity}</td>
                <td className="sale-total">
                  {currencyFormatter.format(item.lineTotalCents / 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sale-detail-footer">
        <dl className="sale-totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{currencyFormatter.format(sale.subtotalCents / 100)}</dd>
          </div>
          <div>
            <dt>Tax</dt>
            <dd>{currencyFormatter.format(sale.taxCents / 100)}</dd>
          </div>
          <div className="sale-total-row">
            <dt>Total</dt>
            <dd>{currencyFormatter.format(sale.totalCents / 100)}</dd>
          </div>
          <div>
            <dt>Payment</dt>
            <dd className="payment-method">{sale.paymentMethod}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export default SalesScreen

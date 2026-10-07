import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { CheckoutQuote, PaymentMethod, SaleDetail } from '../../shared/pos-api'
import {
  addProductToCart,
  changeCartQuantity,
  clearCart,
  removeCartProduct,
  type CartLine
} from './cart'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

interface PosScreenProps {
  cart: CartLine[]
  setCart: Dispatch<SetStateAction<CartLine[]>>
}

interface QuoteState {
  cart: CartLine[]
  quote?: CheckoutQuote
  error?: string
}

function PosScreen({ cart, setCart }: PosScreenProps): React.JSX.Element {
  const [skuInput, setSkuInput] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')
  const [lookupIsError, setLookupIsError] = useState(false)
  const [pendingLookups, setPendingLookups] = useState(0)
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null)
  const [pendingPayment, setPendingPayment] = useState<PaymentMethod | null>(null)
  const [savingSale, setSavingSale] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [completedSale, setCompletedSale] = useState<SaleDetail | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const lookupQueue = useRef<Promise<void>>(Promise.resolve())
  const itemCount = cart.reduce((count, line) => count + line.quantity, 0)
  const quote = quoteState?.cart === cart ? (quoteState.quote ?? null) : null
  const quoteError = quoteState?.cart === cart ? (quoteState.error ?? '') : ''
  const quoteLoading = cart.length > 0 && quoteState?.cart !== cart
  const displayLines = quote?.items ?? cart

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    let current = true
    if (cart.length === 0) return
    const items = cart.map(({ productId, quantity }) => ({ productId, quantity }))
    void window.pos.sales
      .quote(items)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setQuoteState({ cart, quote: result.data })
        } else {
          setQuoteState({ cart, error: result.error.message })
        }
      })
      .catch(() => {
        if (current)
          setQuoteState({ cart, error: 'Sale totals could not be calculated. Try again.' })
      })

    return () => {
      current = false
    }
  }, [cart])

  useEffect(() => {
    if (!pendingPayment) inputRef.current?.focus()
  }, [pendingPayment])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const sku = skuInput.trim()
    setSkuInput('')
    setLookupMessage('')
    setLookupIsError(false)
    setCompletedSale(null)
    inputRef.current?.focus()

    if (!sku) return

    setPendingLookups((count) => count + 1)
    lookupQueue.current = lookupQueue.current.then(async () => {
      try {
        const result = await window.pos.products.getBySku(sku)
        if (!result.ok) {
          setLookupMessage(result.error.message)
          setLookupIsError(true)
        } else if (!result.data) {
          setLookupMessage(`Product not found: ${sku}`)
          setLookupIsError(true)
        } else {
          setCart((current) => addProductToCart(current, result.data))
          setLookupMessage(`${result.data.name} added to cart.`)
          setLookupIsError(false)
        }
      } catch {
        setLookupMessage('Product lookup failed. Try scanning the SKU again.')
        setLookupIsError(true)
      } finally {
        setPendingLookups((count) => Math.max(0, count - 1))
        inputRef.current?.focus()
      }
    })
  }

  function handleClearCart(): void {
    if (cart.length === 0 || savingSale) return
    const itemLabel = itemCount === 1 ? 'item' : 'items'
    if (!window.confirm(`Clear all ${itemCount} ${itemLabel} from the cart?`)) return
    setCart((current) => clearCart(current))
    setLookupMessage('Cart cleared.')
    setLookupIsError(false)
    setCheckoutError('')
    setCompletedSale(null)
    inputRef.current?.focus()
  }

  async function completeSale(): Promise<void> {
    if (!pendingPayment || !quote || savingSale) return
    setSavingSale(true)
    setCheckoutError('')

    try {
      const result = await window.pos.sales.completeCheckout({
        items: cart.map(({ productId, quantity }) => ({ productId, quantity })),
        paymentMethod: pendingPayment
      })

      if (!result.ok) {
        setCheckoutError(result.error.message)
        return
      }

      setCompletedSale(result.data)
      setCart((current) => clearCart(current))
      setPendingPayment(null)
      setLookupMessage('')
      setLookupIsError(false)
    } catch {
      setCheckoutError('The sale could not be saved. Your cart is still available; try again.')
    } finally {
      setSavingSale(false)
    }
  }

  function amount(value: number | undefined): string {
    return value === undefined ? '—' : currencyFormatter.format(value / 100)
  }

  const subtotal = cart.length === 0 ? 0 : quote?.subtotalCents
  const tax = cart.length === 0 ? 0 : quote?.taxCents
  const total = cart.length === 0 ? 0 : quote?.totalCents

  return (
    <section className="pos-page" aria-label="Point of sale cart">
      <div className="pos-entry-card">
        <div>
          <p className="eyebrow">Add products</p>
          <label htmlFor="pos-sku-input">Scan or enter SKU</label>
        </div>
        <form className="pos-sku-form" onSubmit={handleSubmit}>
          <input
            autoComplete="off"
            autoFocus
            disabled={savingSale}
            id="pos-sku-input"
            ref={inputRef}
            value={skuInput}
            onChange={(event) => setSkuInput(event.target.value)}
            placeholder="Enter SKU, then press Enter"
            aria-describedby="pos-sku-feedback"
          />
          <button className="primary-button" type="submit" disabled={savingSale}>
            Add to cart
          </button>
        </form>
        <p
          className={`pos-feedback${lookupIsError ? ' is-error' : ''}`}
          id="pos-sku-feedback"
          aria-live={lookupIsError ? 'assertive' : 'polite'}
          role={lookupIsError ? 'alert' : 'status'}
        >
          {pendingLookups > 0
            ? `Looking up ${pendingLookups} ${pendingLookups === 1 ? 'SKU' : 'SKUs'}…`
            : lookupMessage || 'Enter an active product SKU to add it to the cart.'}
        </p>
      </div>

      {completedSale && (
        <div className="sale-success" role="status">
          <span>
            Sale #{completedSale.id} completed ·{' '}
            {currencyFormatter.format(completedSale.totalCents / 100)}
          </span>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setCompletedSale(null)
              inputRef.current?.focus()
            }}
          >
            New sale
          </button>
        </div>
      )}

      <div className="pos-cart-card">
        <div className="pos-cart-heading">
          <div>
            <p className="eyebrow">Current sale</p>
            <h2>Cart</h2>
          </div>
          {cart.length > 0 && (
            <button
              className="text-button danger-text"
              type="button"
              disabled={pendingLookups > 0 || savingSale}
              onClick={handleClearCart}
            >
              Clear cart
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <div className="pos-empty-cart">
            <div className="empty-product-mark" aria-hidden="true">
              ＋
            </div>
            <h3>Cart is empty</h3>
            <p>Scan a product SKU to start a sale.</p>
          </div>
        ) : (
          <div className="pos-cart-content">
            <div className="pos-cart-scroll">
              <table className="pos-cart-table">
                <thead>
                  <tr>
                    <th scope="col">SKU</th>
                    <th scope="col">Product</th>
                    <th scope="col">Price</th>
                    <th scope="col">Quantity</th>
                    <th scope="col">Line total</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayLines.map((line) => (
                    <tr key={line.productId}>
                      <td className="product-sku">{line.sku}</td>
                      <td className="product-name-cell">{line.name}</td>
                      <td>{currencyFormatter.format(line.unitPriceCents / 100)}</td>
                      <td>
                        <div
                          className="cart-quantity-controls"
                          aria-label={`${line.name} quantity`}
                        >
                          <button
                            className="quantity-button"
                            type="button"
                            aria-label={`Decrease ${line.name} quantity`}
                            disabled={line.quantity <= 1 || savingSale}
                            onClick={() =>
                              setCart((current) => changeCartQuantity(current, line.productId, -1))
                            }
                          >
                            −
                          </button>
                          <span aria-live="polite">{line.quantity}</span>
                          <button
                            className="quantity-button"
                            type="button"
                            aria-label={`Increase ${line.name} quantity`}
                            disabled={savingSale}
                            onClick={() =>
                              setCart((current) => changeCartQuantity(current, line.productId, 1))
                            }
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="pos-line-total">
                        {currencyFormatter.format(
                          ('lineTotalCents' in line && typeof line.lineTotalCents === 'number'
                            ? line.lineTotalCents
                            : line.unitPriceCents * line.quantity) / 100
                        )}
                      </td>
                      <td>
                        <button
                          className="text-button danger-text"
                          type="button"
                          aria-label={`Remove ${line.name}`}
                          disabled={savingSale}
                          onClick={() =>
                            setCart((current) => removeCartProduct(current, line.productId))
                          }
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pos-checkout-footer">
              <div className="pos-totals" aria-live="polite">
                <div>
                  <span>
                    Subtotal{' '}
                    <span className="pos-unit-count">
                      · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </span>
                  <strong>{quoteLoading ? 'Updating…' : amount(subtotal)}</strong>
                </div>
                <div>
                  <span>Tax</span>
                  <strong>{quoteLoading ? 'Updating…' : amount(tax)}</strong>
                </div>
                <div className="pos-total-row">
                  <span>Total</span>
                  <strong>{quoteLoading ? 'Updating…' : amount(total)}</strong>
                </div>
              </div>
              {quoteError && (
                <p className="product-banner-error checkout-quote-error" role="alert">
                  {quoteError}
                </p>
              )}
              <div className="payment-actions">
                <span>Choose payment</span>
                <div>
                  <button
                    className="secondary-button payment-button"
                    type="button"
                    disabled={!quote || quoteLoading || pendingLookups > 0 || savingSale}
                    onClick={() => {
                      setCheckoutError('')
                      setPendingPayment('cash')
                    }}
                  >
                    Cash
                  </button>
                  <button
                    className="primary-button payment-button"
                    type="button"
                    disabled={!quote || quoteLoading || pendingLookups > 0 || savingSale}
                    onClick={() => {
                      setCheckoutError('')
                      setPendingPayment('card')
                    }}
                  >
                    Card
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {pendingPayment && quote && (
        <CheckoutConfirmationDialog
          paymentMethod={pendingPayment}
          totalCents={quote.totalCents}
          error={checkoutError}
          saving={savingSale}
          onCancel={() => {
            if (!savingSale) {
              setPendingPayment(null)
              setCheckoutError('')
            }
          }}
          onConfirm={() => void completeSale()}
        />
      )}
    </section>
  )
}

interface CheckoutConfirmationDialogProps {
  paymentMethod: PaymentMethod
  totalCents: number
  error: string
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}

function CheckoutConfirmationDialog({
  paymentMethod,
  totalCents,
  error,
  saving,
  onCancel,
  onConfirm
}: CheckoutConfirmationDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  const methodLabel = paymentMethod === 'cash' ? 'Cash' : 'Card'

  return (
    <dialog
      className="product-dialog checkout-dialog"
      ref={dialogRef}
      aria-labelledby="checkout-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Payment method: {methodLabel}</p>
          <h2 id="checkout-dialog-title">Complete {methodLabel} Sale?</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Close"
          disabled={saving}
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <div className="checkout-confirmation">
        <span>Total</span>
        <strong>{currencyFormatter.format(totalCents / 100)}</strong>
        {error && (
          <p className="product-banner-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dialog-actions checkout-dialog-actions">
        <button className="secondary-button" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button className="primary-button" type="button" disabled={saving} onClick={onConfirm}>
          {saving ? 'Saving sale…' : 'Complete Sale'}
        </button>
      </div>
    </dialog>
  )
}

export default PosScreen

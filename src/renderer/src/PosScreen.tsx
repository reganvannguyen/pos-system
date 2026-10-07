import { useCallback, useEffect, useRef, useState } from 'react'
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
  const [quoteRetryKey, setQuoteRetryKey] = useState(0)
  const [pendingPayment, setPendingPayment] = useState<PaymentMethod | null>(null)
  const [savingSale, setSavingSale] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [completedSale, setCompletedSale] = useState<SaleDetail | null>(null)
  const [printingReceipt, setPrintingReceipt] = useState(false)
  const [receiptSent, setReceiptSent] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const lookupQueue = useRef<Promise<void>>(Promise.resolve())
  const itemCount = cart.reduce((count, line) => count + line.quantity, 0)
  const quote = quoteState?.cart === cart ? (quoteState.quote ?? null) : null
  const quoteError = quoteState?.cart === cart ? (quoteState.error ?? '') : ''
  const quoteLoading = cart.length > 0 && quoteState?.cart !== cart
  const displayLines = quote?.items ?? cart

  const beginCheckout = useCallback(
    (paymentMethod: PaymentMethod): void => {
      if (!quote || quoteLoading || pendingLookups > 0 || savingSale || pendingPayment) return
      setCheckoutError('')
      setPendingPayment(paymentMethod)
    },
    [pendingLookups, pendingPayment, quote, quoteLoading, savingSale]
  )

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
  }, [cart, quoteRetryKey])

  useEffect(() => {
    if (!pendingPayment && !savingSale) inputRef.current?.focus()
  }, [pendingPayment, savingSale])

  useEffect(() => {
    function handlePosShortcut(event: KeyboardEvent): void {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return
      if (pendingPayment || savingSale) return

      if (event.key === 'F2') {
        event.preventDefault()
        inputRef.current?.focus()
      } else if (event.key === 'F4') {
        event.preventDefault()
        beginCheckout('cash')
      } else if (event.key === 'F5') {
        event.preventDefault()
        beginCheckout('card')
      }
    }

    window.addEventListener('keydown', handlePosShortcut)
    return () => window.removeEventListener('keydown', handlePosShortcut)
  }, [beginCheckout, pendingPayment, savingSale])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const sku = skuInput.trim()
    setSkuInput('')
    setLookupMessage('')
    setLookupIsError(false)
    setCompletedSale(null)
    setReceiptSent(false)
    setReceiptError('')
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
    setReceiptSent(false)
    setReceiptError('')
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

      const sale = result.data.sale
      setCompletedSale(sale)
      setCart((current) => clearCart(current))
      setPendingPayment(null)
      setLookupMessage('')
      setLookupIsError(false)
      setReceiptSent(false)
      setReceiptError('')
      if (result.data.autoPrintReceipt) void sendReceipt(sale.id)
    } catch {
      setCheckoutError('The sale could not be saved. Your cart is still available; try again.')
    } finally {
      setSavingSale(false)
    }
  }

  async function sendReceipt(saleId: number): Promise<void> {
    if (printingReceipt) return
    setPrintingReceipt(true)
    setReceiptError('')
    try {
      const result = await window.pos.receipts.print(saleId)
      if (!result.ok) {
        setReceiptError(result.error.message)
        setReceiptSent(false)
      } else {
        setReceiptSent(true)
      }
    } catch {
      setReceiptError(
        'Receipt could not be sent to the printer. The sale is saved and can be reprinted.'
      )
      setReceiptSent(false)
    } finally {
      setPrintingReceipt(false)
    }
  }

  function amount(value: number | undefined): string {
    return value === undefined ? '—' : currencyFormatter.format(value / 100)
  }

  const subtotal = cart.length === 0 ? 0 : quote?.subtotalCents
  const tax = cart.length === 0 ? 0 : quote?.taxCents
  const total = cart.length === 0 ? 0 : quote?.totalCents
  const checkoutDisabled = !quote || quoteLoading || pendingLookups > 0 || savingSale

  return (
    <section className="pos-page" aria-label="Point of sale">
      {completedSale && (
        <div className="sale-success" role="status">
          <span>
            Sale #{completedSale.id} completed ·{' '}
            {currencyFormatter.format(completedSale.totalCents / 100)}
          </span>
          <span className="sale-success-actions">
            <button
              className="text-button"
              type="button"
              disabled={printingReceipt}
              onClick={() => void sendReceipt(completedSale.id)}
            >
              {printingReceipt ? 'Sending…' : receiptSent ? 'Reprint receipt' : 'Print receipt'}
            </button>
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setCompletedSale(null)
                setReceiptSent(false)
                setReceiptError('')
                inputRef.current?.focus()
              }}
            >
              New sale
            </button>
          </span>
          {receiptError && (
            <span className="sale-receipt-error" role="alert">
              {receiptError}
            </span>
          )}
          {printingReceipt && (
            <span className="sale-receipt-status">Sending receipt to printer…</span>
          )}
          {receiptSent && !printingReceipt && (
            <span className="sale-receipt-status">Receipt sent to printer.</span>
          )}
        </div>
      )}

      <div className="pos-register-layout">
        <div className="pos-workspace">
          <div className="pos-entry-card">
            <div className="pos-entry-heading">
              <div>
                <p className="eyebrow">Add products</p>
                <label htmlFor="pos-sku-input">Scan or enter SKU</label>
              </div>
              <span className="keyboard-hint">
                <kbd>F2</kbd> focus <span aria-hidden="true">·</span> <kbd>Enter</kbd> add
              </span>
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
                placeholder="Scan or enter product SKU"
                aria-describedby="pos-sku-feedback"
                aria-keyshortcuts="F2 Enter"
              />
              <button className="primary-button" type="submit" disabled={savingSale}>
                Add item
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
                : lookupMessage || 'Scan an active product SKU to add it to this sale.'}
            </p>
          </div>

          <div className="pos-cart-card">
            <div className="pos-cart-heading">
              <div>
                <p className="eyebrow">Current sale</p>
                <h2>Items</h2>
              </div>
              {cart.length > 0 && (
                <button
                  className="text-button danger-text"
                  type="button"
                  disabled={pendingLookups > 0 || savingSale}
                  onClick={handleClearCart}
                >
                  Clear sale
                </button>
              )}
            </div>
            {cart.length === 0 ? (
              <div className="pos-empty-cart">
                <div className="empty-product-mark" aria-hidden="true">
                  ＋
                </div>
                <h3>No items yet</h3>
                <p>Scan a product SKU to start a sale.</p>
              </div>
            ) : (
              <div className="pos-cart-content">
                <div className="pos-cart-scroll">
                  <table className="pos-cart-table" aria-label="Items in current sale">
                    <colgroup>
                      <col className="cart-col-sku" />
                      <col className="cart-col-product" />
                      <col className="cart-col-price" />
                      <col className="cart-col-quantity" />
                      <col className="cart-col-total" />
                      <col className="cart-col-action" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">SKU</th>
                        <th scope="col">Product</th>
                        <th scope="col">Price</th>
                        <th scope="col">Qty</th>
                        <th scope="col">Total</th>
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
                              role="group"
                              aria-label={`${line.name} quantity`}
                            >
                              <button
                                className="quantity-button"
                                type="button"
                                aria-label={`Decrease ${line.name} quantity`}
                                disabled={line.quantity <= 1 || savingSale}
                                onClick={() =>
                                  setCart((current) =>
                                    changeCartQuantity(current, line.productId, -1)
                                  )
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
                                  setCart((current) =>
                                    changeCartQuantity(current, line.productId, 1)
                                  )
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
              </div>
            )}
          </div>
        </div>

        <aside className="pos-checkout-panel" aria-label="Checkout summary">
          <div className="checkout-panel-heading">
            <p className="eyebrow">Checkout</p>
            <h2>Sale total</h2>
          </div>
          <p className="checkout-item-count" aria-live="polite">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} in this sale
          </p>
          <div className="checkout-summary" aria-live="polite" aria-busy={quoteLoading}>
            <div>
              <span>Subtotal</span>
              <strong>{quoteLoading ? 'Updating…' : amount(subtotal)}</strong>
            </div>
            <div>
              <span>Tax</span>
              <strong>{quoteLoading ? 'Updating…' : amount(tax)}</strong>
            </div>
            <div className="checkout-grand-total">
              <span>Total</span>
              <strong>{quoteLoading ? 'Updating…' : amount(total)}</strong>
            </div>
          </div>
          {quoteError && (
            <div className="product-banner-error checkout-quote-error">
              <p role="alert">{quoteError}</p>
              <button
                className="text-button"
                type="button"
                disabled={quoteLoading || pendingLookups > 0}
                onClick={() => setQuoteRetryKey((key) => key + 1)}
              >
                Retry totals
              </button>
            </div>
          )}
          <div className="checkout-payment-actions" aria-label="Choose payment method">
            <button
              className="secondary-button payment-button"
              type="button"
              disabled={checkoutDisabled}
              aria-keyshortcuts="F4"
              onClick={() => beginCheckout('cash')}
            >
              Cash <kbd>F4</kbd>
            </button>
            <button
              className="primary-button payment-button"
              type="button"
              disabled={checkoutDisabled}
              aria-keyshortcuts="F5"
              onClick={() => beginCheckout('card')}
            >
              Card <kbd>F5</kbd>
            </button>
          </div>
          <p className="checkout-hint">
            Confirm before saving. Press <kbd>Esc</kbd> to cancel.
          </p>
        </aside>
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

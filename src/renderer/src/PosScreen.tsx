import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import {
  addProductToCart,
  calculateSubtotalCents,
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

function PosScreen({ cart, setCart }: PosScreenProps): React.JSX.Element {
  const [skuInput, setSkuInput] = useState('')
  const [lookupMessage, setLookupMessage] = useState('')
  const [lookupIsError, setLookupIsError] = useState(false)
  const [pendingLookups, setPendingLookups] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const lookupQueue = useRef<Promise<void>>(Promise.resolve())
  const subtotalCents = calculateSubtotalCents(cart)
  const itemCount = cart.reduce((count, line) => count + line.quantity, 0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const sku = skuInput.trim()
    setSkuInput('')
    setLookupMessage('')
    setLookupIsError(false)
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
    if (cart.length === 0) return
    const itemLabel = itemCount === 1 ? 'item' : 'items'
    if (!window.confirm(`Clear all ${itemCount} ${itemLabel} from the cart?`)) return
    setCart((current) => clearCart(current))
    setLookupMessage('Cart cleared.')
    setLookupIsError(false)
    inputRef.current?.focus()
  }

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
            id="pos-sku-input"
            ref={inputRef}
            value={skuInput}
            onChange={(event) => setSkuInput(event.target.value)}
            placeholder="Enter SKU, then press Enter"
            aria-describedby="pos-sku-feedback"
          />
          <button className="primary-button" type="submit">
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
              disabled={pendingLookups > 0}
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
                  {cart.map((line) => (
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
                            disabled={line.quantity <= 1}
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
                            onClick={() =>
                              setCart((current) => changeCartQuantity(current, line.productId, 1))
                            }
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="pos-line-total">
                        {currencyFormatter.format((line.unitPriceCents * line.quantity) / 100)}
                      </td>
                      <td>
                        <button
                          className="text-button danger-text"
                          type="button"
                          aria-label={`Remove ${line.name}`}
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
            <div className="pos-subtotal">
              <span>
                Subtotal{' '}
                <span className="pos-unit-count">
                  · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </span>
              </span>
              <strong>{currencyFormatter.format(subtotalCents / 100)}</strong>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default PosScreen

import { useEffect, useRef, useState } from 'react'
import type {
  Product,
  ProductField,
  ProductInput,
  ProductResult,
  ProductStatus
} from '../../shared/pos-api'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

interface ProductsScreenProps {
  onAddToCart: (product: Product) => void
}

function ProductsScreen({ onAddToCart }: ProductsScreenProps): React.JSX.Element {
  const [status, setStatus] = useState<ProductStatus>('active')
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [editorProduct, setEditorProduct] = useState<Product | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [busyProductId, setBusyProductId] = useState<number | null>(null)

  useEffect(() => {
    let current = true

    void window.pos.products
      .list({ status, query })
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setProducts(result.data)
          setLoadError('')
        } else {
          setLoadError(result.error.message)
        }
      })
      .catch(() => {
        if (current) setLoadError('Products could not be loaded. Try again.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [status, query, reloadKey])

  function openCreateDialog(): void {
    setEditorProduct(null)
    setEditorOpen(true)
    setActionError('')
    setNotice('')
  }

  function openEditDialog(product: Product): void {
    setEditorProduct(product)
    setEditorOpen(true)
    setActionError('')
    setNotice('')
  }

  function reloadProducts(): void {
    setLoading(true)
    setLoadError('')
    setReloadKey((key) => key + 1)
  }

  function changeProductFilter(nextStatus: ProductStatus): void {
    if (nextStatus === status) return
    setLoading(true)
    setLoadError('')
    setStatus(nextStatus)
  }

  function handleSaved(product: Product): void {
    setEditorOpen(false)
    setActionError('')
    setNotice(`${product.name} saved.`)
    setLoading(true)
    setLoadError('')
    if (!editorProduct) {
      setStatus('active')
      setQuery('')
    }
    setReloadKey((key) => key + 1)
  }

  async function changeStatus(product: Product, isActive: boolean): Promise<void> {
    if (!isActive) {
      const confirmed = window.confirm(
        `Deactivate ${product.name}? It will no longer be available for checkout, and its SKU will stay reserved.`
      )
      if (!confirmed) return
    }

    setBusyProductId(product.id)
    setActionError('')
    setNotice('')
    try {
      const result = await window.pos.products.setActive(product.id, isActive)
      if (!result.ok) {
        setActionError(result.error.message)
        return
      }

      setNotice(
        isActive
          ? `${result.data.name} is active again.`
          : `${result.data.name} was deactivated. Its SKU remains reserved.`
      )
      reloadProducts()
    } catch {
      setActionError('The product status could not be changed. Try again.')
    } finally {
      setBusyProductId(null)
    }
  }

  return (
    <section className="products-page" aria-label="Product catalog">
      <div className="products-toolbar">
        <label className="product-search">
          <span className="visually-hidden">Search products by SKU or name</span>
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search SKU or product name"
          />
        </label>

        <div className="product-status-filter" role="group" aria-label="Product status">
          {(['active', 'inactive'] as const).map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={status === item}
              className={status === item ? 'is-selected' : ''}
              onClick={() => changeProductFilter(item)}
            >
              {item === 'active' ? 'Active' : 'Inactive'}
            </button>
          ))}
        </div>

        <button className="primary-button" type="button" onClick={openCreateDialog}>
          <span aria-hidden="true">＋</span> Add product
        </button>
      </div>

      {notice && (
        <p className="product-notice" role="status">
          {notice}
        </p>
      )}
      {actionError && (
        <p className="product-banner-error" role="alert">
          {actionError}
        </p>
      )}

      <div className="product-table-card">
        {loading ? (
          <div className="products-state" role="status">
            Loading products…
          </div>
        ) : loadError ? (
          <div className="products-state products-error-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="secondary-button" onClick={reloadProducts}>
              Retry
            </button>
          </div>
        ) : products.length === 0 ? (
          <div className="products-state">
            <div className="empty-product-mark" aria-hidden="true">
              {status === 'active' ? '＋' : '✓'}
            </div>
            <h2>{query ? 'No matching products' : `No ${status} products`}</h2>
            <p>
              {query
                ? 'Try a different SKU or product name.'
                : status === 'active'
                  ? 'Add products here to make them available at checkout.'
                  : 'Deactivated products will appear here.'}
            </p>
            {status === 'active' && !query && (
              <button type="button" className="primary-button" onClick={openCreateDialog}>
                Add first product
              </button>
            )}
          </div>
        ) : (
          <div className="product-table-scroll">
            <table className="product-table">
              <thead>
                <tr>
                  <th scope="col">SKU</th>
                  <th scope="col">Product</th>
                  <th scope="col">Price</th>
                  <th scope="col">Stock</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="product-sku">{product.sku}</td>
                    <td className="product-name-cell">{product.name}</td>
                    <td>{currencyFormatter.format(product.priceCents / 100)}</td>
                    <td>
                      {product.stockQuantity === null
                        ? 'Not tracked'
                        : `${product.stockQuantity} ${product.stockQuantity === 1 ? 'unit' : 'units'}`}
                    </td>
                    <td>
                      <span
                        className={`product-status-pill ${product.isActive ? 'active' : 'inactive'}`}
                      >
                        {product.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="product-row-actions">
                        {product.isActive && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => onAddToCart(product)}
                          >
                            Add to cart
                          </button>
                        )}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => openEditDialog(product)}
                          disabled={busyProductId === product.id}
                        >
                          Edit
                        </button>
                        {product.isActive ? (
                          <button
                            type="button"
                            className="text-button danger-text"
                            onClick={() => void changeStatus(product, false)}
                            disabled={busyProductId === product.id}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => void changeStatus(product, true)}
                            disabled={busyProductId === product.id}
                          >
                            {busyProductId === product.id ? 'Restoring…' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="product-count">
              {products.length} {products.length === 1 ? 'product' : 'products'}
            </p>
          </div>
        )}
      </div>

      {editorOpen && (
        <ProductEditorDialog
          product={editorProduct}
          onCancel={() => setEditorOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </section>
  )
}

interface ProductEditorDialogProps {
  product: Product | null
  onCancel: () => void
  onSaved: (product: Product) => void
}

function ProductEditorDialog({
  product,
  onCancel,
  onSaved
}: ProductEditorDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<ProductInput>(() =>
    product
      ? {
          sku: product.sku,
          name: product.name,
          price: (product.priceCents / 100).toFixed(2),
          stockQuantity: product.stockQuantity === null ? '' : String(product.stockQuantity)
        }
      : { sku: '', name: '', price: '', stockQuantity: '' }
  )
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProductField, string>>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function updateField(field: keyof ProductInput, value: string): void {
    setInput((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    setFieldErrors({})

    try {
      const result = product
        ? await window.pos.products.update(product.id, input)
        : await window.pos.products.create(input)

      if (result.ok) {
        onSaved(result.data)
      } else {
        showProductError(result)
      }
    } catch {
      setFormError('The product could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  function showProductError(result: Extract<ProductResult<Product>, { ok: false }>): void {
    if (result.error.field) setFieldErrors({ [result.error.field]: result.error.message })
    else setFormError(result.error.message)
  }

  return (
    <dialog
      className="product-dialog"
      ref={dialogRef}
      aria-labelledby="product-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Product catalog</p>
          <h2 id="product-dialog-title">{product ? 'Edit product' : 'Add product'}</h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Close"
          onClick={onCancel}
          disabled={saving}
        >
          ×
        </button>
      </div>

      <form className="product-form" onSubmit={(event) => void save(event)} noValidate>
        <div className="form-field">
          <label htmlFor="product-sku">SKU</label>
          <input
            id="product-sku"
            name="sku"
            autoFocus
            autoComplete="off"
            value={input.sku}
            onChange={(event) => updateField('sku', event.target.value)}
            aria-invalid={Boolean(fieldErrors.sku)}
            aria-describedby={fieldErrors.sku ? 'product-sku-error' : 'product-sku-help'}
          />
          {fieldErrors.sku ? (
            <span className="field-error" id="product-sku-error">
              {fieldErrors.sku}
            </span>
          ) : (
            <span className="field-help" id="product-sku-help">
              Saved uppercase. Must be unique across active and inactive products.
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="product-name">Product name</label>
          <input
            id="product-name"
            name="name"
            autoComplete="off"
            value={input.name}
            onChange={(event) => updateField('name', event.target.value)}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'product-name-error' : undefined}
          />
          {fieldErrors.name && (
            <span className="field-error" id="product-name-error">
              {fieldErrors.name}
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="product-price">Price (CAD)</label>
          <div className="money-input">
            <span aria-hidden="true">$</span>
            <input
              id="product-price"
              name="price"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={input.price}
              onChange={(event) => updateField('price', event.target.value)}
              aria-invalid={Boolean(fieldErrors.price)}
              aria-describedby={fieldErrors.price ? 'product-price-error' : 'product-price-help'}
            />
          </div>
          {fieldErrors.price ? (
            <span className="field-error" id="product-price-error">
              {fieldErrors.price}
            </span>
          ) : (
            <span className="field-help" id="product-price-help">
              Enter a non-negative amount with up to two decimal places.
            </span>
          )}
        </div>

        <div className="form-field">
          <label htmlFor="product-stock">Stock quantity</label>
          <input
            id="product-stock"
            name="stockQuantity"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Not tracked"
            value={input.stockQuantity}
            onChange={(event) => updateField('stockQuantity', event.target.value)}
            aria-invalid={Boolean(fieldErrors.stockQuantity)}
            aria-describedby={
              fieldErrors.stockQuantity ? 'product-stock-error' : 'product-stock-help'
            }
          />
          {fieldErrors.stockQuantity ? (
            <span className="field-error" id="product-stock-error">
              {fieldErrors.stockQuantity}
            </span>
          ) : (
            <span className="field-help" id="product-stock-help">
              Leave blank to stop tracking stock. Enter 0 to track an empty shelf.
            </span>
          )}
        </div>

        {formError && (
          <p className="product-banner-error" role="alert">
            {formError}
          </p>
        )}

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? 'Saving…' : product ? 'Save changes' : 'Add product'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

export default ProductsScreen

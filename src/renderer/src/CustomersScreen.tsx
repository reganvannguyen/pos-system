import { useEffect, useRef, useState } from 'react'
import type { Customer, CustomerField, CustomerInput, CustomerResult } from '../../shared/pos-api'

const emptyCustomer: CustomerInput = {
  firstName: '',
  lastName: '',
  companyName: '',
  address: '',
  phoneNumber: '',
  email: '',
  imageDataUrl: null
}

interface CustomersScreenProps {
  onCustomerChanged?: (customer: Customer) => void
}

function CustomersScreen({ onCustomerChanged }: CustomersScreenProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [editorCustomer, setEditorCustomer] = useState<Customer | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let current = true
    void window.pos.customers
      .list(query)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setCustomers(result.data)
          setLoadError('')
        } else {
          setLoadError(result.error.message)
        }
      })
      .catch(() => {
        if (current) setLoadError('Customers could not be loaded. Try again.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })

    return () => {
      current = false
    }
  }, [query, reloadKey])

  function openCreateDialog(): void {
    setEditorCustomer(null)
    setEditorOpen(true)
    setNotice('')
  }

  function openEditDialog(customer: Customer): void {
    setEditorCustomer(customer)
    setEditorOpen(true)
    setNotice('')
  }

  function reloadCustomers(): void {
    setLoading(true)
    setLoadError('')
    setReloadKey((key) => key + 1)
  }

  function handleSaved(customer: Customer): void {
    setEditorOpen(false)
    setNotice(`${customerName(customer)} saved.`)
    if (editorCustomer) onCustomerChanged?.(customer)
    if (!editorCustomer) setQuery('')
    setLoading(true)
    setReloadKey((key) => key + 1)
  }

  return (
    <section className="products-page" aria-label="Customer lookup">
      <div className="products-toolbar">
        <label className="product-search">
          <span className="visually-hidden">Search customers</span>
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setLoading(true)
              setQuery(event.target.value)
            }}
            placeholder="Search name, company, phone, or email"
            maxLength={200}
          />
        </label>
        <button className="primary-button" type="button" onClick={openCreateDialog}>
          <span aria-hidden="true">＋</span> Add customer
        </button>
      </div>

      {notice && (
        <p className="product-notice" role="status">
          {notice}
        </p>
      )}

      <div className="product-table-card">
        {loading ? (
          <div className="products-state" role="status">
            Loading customers…
          </div>
        ) : loadError ? (
          <div className="products-state products-error-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="secondary-button" onClick={reloadCustomers}>
              Retry
            </button>
          </div>
        ) : customers.length === 0 ? (
          <div className="products-state">
            <div className="empty-product-mark" aria-hidden="true">
              ＋
            </div>
            <h2>{query ? 'No matching customers' : 'No customers yet'}</h2>
            <p>
              {query
                ? 'Try another name, company, phone number, or email.'
                : 'Add a customer to save their contact details here.'}
            </p>
            {!query && (
              <button type="button" className="primary-button" onClick={openCreateDialog}>
                Add first customer
              </button>
            )}
          </div>
        ) : (
          <div className="product-table-scroll">
            <table className="product-table customer-table">
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Company</th>
                  <th scope="col">Telephone</th>
                  <th scope="col">Email</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.id}>
                    <td className="customer-name-cell">
                      <span className="customer-identity">
                        {customer.imageDataUrl ? (
                          <img className="customer-avatar" src={customer.imageDataUrl} alt="" />
                        ) : (
                          <span
                            className="customer-avatar customer-avatar-placeholder"
                            aria-hidden="true"
                          >
                            {customerInitials(customer)}
                          </span>
                        )}
                        <span>{customerName(customer)}</span>
                      </span>
                    </td>
                    <td>{customer.companyName || '—'}</td>
                    <td>{customer.phoneNumber || '—'}</td>
                    <td>{customer.email || '—'}</td>
                    <td>
                      <div className="product-row-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => openEditDialog(customer)}
                          aria-label={`Edit ${customerName(customer)}`}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="product-count">
              {customers.length} {customers.length === 1 ? 'customer' : 'customers'}
            </p>
          </div>
        )}
      </div>

      {editorOpen && (
        <CustomerEditorDialog
          customer={editorCustomer}
          onCancel={() => setEditorOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </section>
  )
}

export interface CustomerEditorDialogProps {
  customer: Customer | null
  onCancel: () => void
  onSaved: (customer: Customer) => void
}

export function CustomerEditorDialog({
  customer,
  onCancel,
  onSaved
}: CustomerEditorDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<CustomerInput>(() =>
    customer
      ? {
          firstName: customer.firstName,
          lastName: customer.lastName,
          companyName: customer.companyName,
          address: customer.address,
          phoneNumber: customer.phoneNumber,
          email: customer.email,
          imageDataUrl: customer.imageDataUrl
        }
      : emptyCustomer
  )
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<CustomerField, string>>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    setFieldErrors({})

    try {
      const result = customer
        ? await window.pos.customers.update(customer.id, input)
        : await window.pos.customers.create(input)
      if (result.ok) onSaved(result.data)
      else showCustomerError(result)
    } catch {
      setFormError('The customer could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function loadPhoto(file: File | undefined): Promise<void> {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setFieldErrors((current) => ({
        ...current,
        imageDataUrl: 'Choose a PNG, JPEG, or WebP image.'
      }))
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setFieldErrors((current) => ({ ...current, imageDataUrl: 'Choose an image under 2 MB.' }))
      return
    }

    try {
      const imageDataUrl = await readImage(file)
      setInput((current) => ({ ...current, imageDataUrl }))
      setFieldErrors((current) => ({ ...current, imageDataUrl: undefined }))
      setFormError('')
    } catch {
      setFieldErrors((current) => ({
        ...current,
        imageDataUrl: 'The image could not be loaded.'
      }))
    }
  }

  function updateField(field: keyof CustomerInput, value: string): void {
    setInput((current) => ({ ...current, [field]: value }))
    setFieldErrors((current) => ({ ...current, [field]: undefined }))
    setFormError('')
  }

  function showCustomerError(result: Extract<CustomerResult<Customer>, { ok: false }>): void {
    if (result.error.field) setFieldErrors({ [result.error.field]: result.error.message })
    else setFormError(result.error.message)
  }

  return (
    <dialog
      className="product-dialog customer-dialog"
      ref={dialogRef}
      aria-labelledby="customer-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!saving) onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Customer records</p>
          <h2 id="customer-dialog-title">{customer ? 'Edit customer' : 'Add customer'}</h2>
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
        <div className="customer-form-name-row">
          <CustomerTextField
            id="customer-first-name"
            label="First name"
            value={input.firstName}
            error={fieldErrors.firstName}
            onChange={(value) => updateField('firstName', value)}
          />
          <CustomerTextField
            id="customer-last-name"
            label="Last name"
            value={input.lastName}
            error={fieldErrors.lastName}
            onChange={(value) => updateField('lastName', value)}
          />
        </div>

        <CustomerTextField
          id="customer-company-name"
          label="Company name"
          value={input.companyName}
          error={fieldErrors.companyName}
          onChange={(value) => updateField('companyName', value)}
        />
        <CustomerTextField
          id="customer-address"
          label="Address"
          value={input.address}
          error={fieldErrors.address}
          onChange={(value) => updateField('address', value)}
        />
        <div className="customer-form-name-row">
          <CustomerTextField
            id="customer-phone"
            label="Telephone number"
            value={input.phoneNumber}
            error={fieldErrors.phoneNumber}
            onChange={(value) => updateField('phoneNumber', value)}
            type="tel"
          />
          <CustomerTextField
            id="customer-email"
            label="Email address"
            value={input.email}
            error={fieldErrors.email}
            onChange={(value) => updateField('email', value)}
            type="email"
          />
        </div>

        <div className="form-field customer-photo-field">
          <label htmlFor="customer-photo">Customer image (optional)</label>
          {input.imageDataUrl && (
            <div className="customer-photo-preview-wrap">
              <img className="customer-photo-preview" src={input.imageDataUrl} alt="Customer" />
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => {
                  setInput((current) => ({ ...current, imageDataUrl: null }))
                  setFieldErrors((current) => ({ ...current, imageDataUrl: undefined }))
                }}
              >
                Remove image
              </button>
            </div>
          )}
          <input
            id="customer-photo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void loadPhoto(file)
            }}
            aria-invalid={Boolean(fieldErrors.imageDataUrl)}
            aria-describedby={
              fieldErrors.imageDataUrl ? 'customer-photo-error' : 'customer-photo-help'
            }
          />
          {fieldErrors.imageDataUrl ? (
            <span className="field-error" id="customer-photo-error">
              {fieldErrors.imageDataUrl}
            </span>
          ) : (
            <span className="field-help" id="customer-photo-help">
              PNG, JPEG, or WebP up to 2 MB. The image is included in the customer record.
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
            {saving ? 'Saving…' : customer ? 'Save changes' : 'Add customer'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

interface CustomerLookupDialogProps {
  selectedCustomerId: number | null
  onSelect: (customer: Customer | null) => void
  onCancel: () => void
}

export function CustomerLookupDialog({
  selectedCustomerId,
  onSelect,
  onCancel
}: CustomerLookupDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editorCustomer, setEditorCustomer] = useState<Customer | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  useEffect(() => {
    let current = true
    void window.pos.customers
      .list(query)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setCustomers(result.data)
          setError('')
        } else {
          setError(result.error.message)
        }
      })
      .catch(() => {
        if (current) setError('Customers could not be loaded. Try again.')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [query, reloadKey])

  function openCreateDialog(): void {
    setEditorCustomer(null)
    setEditorOpen(true)
  }

  function openEditDialog(customer: Customer): void {
    setEditorCustomer(customer)
    setEditorOpen(true)
  }

  function handleSaved(customer: Customer): void {
    setEditorOpen(false)
    onSelect(customer)
  }

  return (
    <dialog
      className="product-dialog customer-picker-dialog"
      ref={dialogRef}
      aria-labelledby="customer-picker-title"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">Current {selectedCustomerId ? 'customer' : 'sale'}</p>
          <h2 id="customer-picker-title">Select a customer</h2>
        </div>
        <button className="dialog-close-button" type="button" aria-label="Close" onClick={onCancel}>
          ×
        </button>
      </div>
      <div className="customer-picker-content">
        <label className="product-search">
          <span className="visually-hidden">Search customers</span>
          <span className="search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setLoading(true)
              setQuery(event.target.value)
            }}
            placeholder="Search name, company, phone, or email"
            maxLength={200}
            autoFocus
          />
        </label>
        {selectedCustomerId !== null && (
          <button className="text-button danger-text" type="button" onClick={() => onSelect(null)}>
            Clear selected customer
          </button>
        )}
        <button className="primary-button" type="button" onClick={openCreateDialog}>
          <span aria-hidden="true">＋</span> Add new customer
        </button>
        <div className="customer-picker-list" aria-live="polite">
          {loading ? (
            <div className="products-state" role="status">
              Loading customers…
            </div>
          ) : error ? (
            <div className="products-state products-error-state" role="alert">
              <p>{error}</p>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setLoading(true)
                  setReloadKey((key) => key + 1)
                }}
              >
                Retry
              </button>
            </div>
          ) : customers.length === 0 ? (
            <div className="products-state">
              {query
                ? 'No matching customers.'
                : 'No customers yet. Add one to select a customer for this transaction.'}
            </div>
          ) : (
            customers.map((customer) => (
              <div className="customer-picker-row" key={customer.id}>
                <button
                  className="customer-picker-select"
                  type="button"
                  onClick={() => onSelect(customer)}
                >
                  {customer.imageDataUrl ? (
                    <img className="customer-avatar" src={customer.imageDataUrl} alt="" />
                  ) : (
                    <span
                      className="customer-avatar customer-avatar-placeholder"
                      aria-hidden="true"
                    >
                      {customerInitials(customer)}
                    </span>
                  )}
                  <span>
                    <strong>{customerName(customer)}</strong>
                    <small>
                      {[customer.companyName, customer.phoneNumber, customer.email]
                        .filter(Boolean)
                        .join(' · ') || 'No additional details'}
                    </small>
                  </span>
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => openEditDialog(customer)}
                  aria-label={`Edit ${customerName(customer)}`}
                >
                  Edit
                </button>
              </div>
            ))
          )}
        </div>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
      {editorOpen && (
        <CustomerEditorDialog
          customer={editorCustomer}
          onCancel={() => setEditorOpen(false)}
          onSaved={handleSaved}
        />
      )}
    </dialog>
  )
}

interface CustomerTextFieldProps {
  id: string
  label: string
  value: string
  error?: string
  type?: string
  onChange: (value: string) => void
}

function CustomerTextField({
  id,
  label,
  value,
  error,
  type = 'text',
  onChange
}: CustomerTextFieldProps): React.JSX.Element {
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  )
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Unsupported image data.'))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Image read failed.')))
    reader.readAsDataURL(file)
  })
}

function customerName(customer: Pick<Customer, 'firstName' | 'lastName' | 'companyName'>): string {
  const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ')
  return name || customer.companyName
}

function customerInitials(customer: Customer): string {
  const name = customerName(customer)
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('en-CA') ?? '')
    .join('')
}

export default CustomersScreen

import { useCallback, useEffect, useState } from 'react'
import type { BusinessSettingsField, PrinterOption } from '../../shared/pos-api'

function SettingsScreen(): React.JSX.Element {
  const [businessName, setBusinessName] = useState('')
  const [taxRatePercent, setTaxRatePercent] = useState('')
  const [businessLoading, setBusinessLoading] = useState(true)
  const [businessLoaded, setBusinessLoaded] = useState(false)
  const [businessSaving, setBusinessSaving] = useState(false)
  const [businessError, setBusinessError] = useState('')
  const [businessFieldErrors, setBusinessFieldErrors] = useState<
    Partial<Record<BusinessSettingsField, string>>
  >({})
  const [businessNotice, setBusinessNotice] = useState('')

  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false)
  const [receiptLoading, setReceiptLoading] = useState(true)
  const [printerLoading, setPrinterLoading] = useState(false)
  const [receiptLoaded, setReceiptLoaded] = useState(false)
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptNotice, setReceiptNotice] = useState('')

  const loadBusinessSettings = useCallback(async (): Promise<void> => {
    setBusinessLoading(true)
    setBusinessError('')
    setBusinessNotice('')
    try {
      const result = await window.pos.settings.getBusiness()
      if (!result.ok) {
        setBusinessError(result.error.message)
        return
      }

      setBusinessName(result.data.businessName)
      setTaxRatePercent(formatTaxRate(result.data.taxRateBasisPoints))
      setBusinessLoaded(true)
    } catch {
      setBusinessError('Business settings could not be loaded. Try again.')
    } finally {
      setBusinessLoading(false)
    }
  }, [])

  const loadReceiptSettings = useCallback(async (): Promise<void> => {
    setReceiptLoading(true)
    setReceiptError('')
    setReceiptNotice('')
    try {
      const [printerResult, settingsResult] = await Promise.all([
        window.pos.printers.list(),
        window.pos.settings.getReceipt()
      ])
      if (printerResult.ok) setPrinters(printerResult.data)
      else setReceiptError(printerResult.error.message)

      if (settingsResult.ok) {
        setPrinterName(settingsResult.data.printerName)
        setAutoPrintReceipt(settingsResult.data.autoPrintReceipt)
        setReceiptLoaded(true)
      } else {
        setReceiptError(settingsResult.error.message)
      }
    } catch {
      setReceiptError('Receipt settings could not be loaded. Try again.')
    } finally {
      setReceiptLoading(false)
    }
  }, [])

  async function refreshPrinters(): Promise<void> {
    setPrinterLoading(true)
    setReceiptError('')
    setReceiptNotice('')
    try {
      const result = await window.pos.printers.list()
      if (!result.ok) {
        setReceiptError(result.error.message)
        return
      }
      setPrinters(result.data)
    } catch {
      setReceiptError('Printers could not be refreshed. Try again.')
    } finally {
      setPrinterLoading(false)
    }
  }

  useEffect(() => {
    void Promise.resolve().then(loadBusinessSettings)
    void Promise.resolve().then(loadReceiptSettings)
  }, [loadBusinessSettings, loadReceiptSettings])

  async function saveBusinessSettings(): Promise<void> {
    setBusinessSaving(true)
    setBusinessError('')
    setBusinessFieldErrors({})
    setBusinessNotice('')
    try {
      const result = await window.pos.settings.saveBusiness({ businessName, taxRatePercent })
      if (!result.ok) {
        if (result.error.field) {
          setBusinessFieldErrors({ [result.error.field]: result.error.message })
        } else {
          setBusinessError(result.error.message)
        }
        return
      }

      setBusinessName(result.data.businessName)
      setTaxRatePercent(formatTaxRate(result.data.taxRateBasisPoints))
      setBusinessLoaded(true)
      setBusinessNotice('Business settings saved.')
    } catch {
      setBusinessError('Business settings could not be saved. Try again.')
    } finally {
      setBusinessSaving(false)
    }
  }

  async function saveReceiptSettings(): Promise<void> {
    setReceiptSaving(true)
    setReceiptError('')
    setReceiptNotice('')
    try {
      const result = await window.pos.settings.saveReceipt({ printerName, autoPrintReceipt })
      if (!result.ok) {
        setReceiptError(result.error.message)
        return
      }
      setPrinterName(result.data.printerName)
      setAutoPrintReceipt(result.data.autoPrintReceipt)
      setReceiptNotice('Receipt settings saved.')
    } catch {
      setReceiptError('Receipt settings could not be saved. Try again.')
    } finally {
      setReceiptSaving(false)
    }
  }

  const unavailableSavedPrinter =
    printerName !== null && !printers.some((printer) => printer.name === printerName)

  return (
    <section className="settings-page" aria-label="Settings">
      <section className="settings-card" aria-labelledby="business-settings-title">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Store setup</p>
            <h2 id="business-settings-title">Business</h2>
            <p className="settings-copy">
              These details appear on receipts and are used to calculate checkout tax.
            </p>
          </div>
        </div>

        {businessLoading ? (
          <p className="settings-state" role="status">
            Loading business settings…
          </p>
        ) : !businessLoaded ? (
          <div className="settings-state settings-load-error" role="alert">
            <p>{businessError || 'Business settings could not be loaded.'}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadBusinessSettings()}
            >
              Retry
            </button>
          </div>
        ) : (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveBusinessSettings()
            }}
          >
            <label className="settings-field" htmlFor="business-name">
              <span>Business name</span>
              <input
                id="business-name"
                type="text"
                autoComplete="organization"
                value={businessName}
                disabled={businessSaving}
                aria-invalid={Boolean(businessFieldErrors.businessName)}
                aria-describedby={
                  businessFieldErrors.businessName ? 'business-name-error' : undefined
                }
                onChange={(event) => {
                  setBusinessName(event.target.value)
                  setBusinessFieldErrors((current) => ({ ...current, businessName: undefined }))
                  setBusinessError('')
                  setBusinessNotice('')
                }}
              />
              {businessFieldErrors.businessName && (
                <small id="business-name-error" className="settings-help is-error" role="alert">
                  {businessFieldErrors.businessName}
                </small>
              )}
            </label>

            <label className="settings-field" htmlFor="business-tax-rate">
              <span>Tax rate</span>
              <div className="settings-percent-input">
                <input
                  id="business-tax-rate"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={taxRatePercent}
                  disabled={businessSaving}
                  aria-invalid={Boolean(businessFieldErrors.taxRatePercent)}
                  aria-describedby={
                    businessFieldErrors.taxRatePercent ? 'business-tax-error' : 'business-tax-help'
                  }
                  onChange={(event) => {
                    setTaxRatePercent(event.target.value)
                    setBusinessFieldErrors((current) => ({ ...current, taxRatePercent: undefined }))
                    setBusinessError('')
                    setBusinessNotice('')
                  }}
                />
                <span aria-hidden="true">%</span>
              </div>
              {businessFieldErrors.taxRatePercent ? (
                <small id="business-tax-error" className="settings-help is-error" role="alert">
                  {businessFieldErrors.taxRatePercent}
                </small>
              ) : (
                <small id="business-tax-help" className="settings-help">
                  Enter 0 to 100, with up to two decimal places.
                </small>
              )}
            </label>

            {businessError && (
              <p className="product-banner-error" role="alert">
                {businessError}
              </p>
            )}
            {businessNotice && (
              <p className="settings-notice" role="status">
                {businessNotice}
              </p>
            )}
            <div className="settings-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={businessSaving}
                onClick={() => void saveBusinessSettings()}
              >
                {businessSaving ? 'Saving…' : 'Save business settings'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="settings-card" aria-labelledby="receipt-settings-title">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Register hardware</p>
            <h2 id="receipt-settings-title">Receipt</h2>
            <p className="settings-copy">
              Choose where receipts print. The printer driver controls the paper size; use an 80 mm
              receipt setting for this register.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={printerLoading || receiptLoading || receiptSaving}
            onClick={() => void refreshPrinters()}
          >
            {printerLoading ? 'Refreshing…' : 'Refresh printers'}
          </button>
        </div>

        {receiptLoading ? (
          <p className="settings-state" role="status">
            Loading receipt settings…
          </p>
        ) : !receiptLoaded ? (
          <div className="settings-state settings-load-error" role="alert">
            <p>{receiptError || 'Receipt settings could not be loaded.'}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadReceiptSettings()}
            >
              Retry
            </button>
          </div>
        ) : (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveReceiptSettings()
            }}
          >
            <label className="settings-field" htmlFor="receipt-printer">
              <span>Receipt printer</span>
              <select
                id="receipt-printer"
                value={printerName ?? ''}
                disabled={receiptSaving || printerLoading}
                onChange={(event) => setPrinterName(event.target.value || null)}
              >
                <option value="">No printer selected</option>
                {unavailableSavedPrinter && (
                  <option value={printerName!}>{printerName} (Unavailable)</option>
                )}
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name}>
                    {printer.displayName}
                    {printer.description ? ` — ${printer.description}` : ''}
                  </option>
                ))}
              </select>
              {unavailableSavedPrinter && (
                <small className="settings-help is-error">
                  The saved printer is not connected. Select another printer or clear this choice.
                </small>
              )}
              {!unavailableSavedPrinter && printers.length === 0 && (
                <small className="settings-help">
                  No printers were found. Connect a receipt printer and refresh this list.
                </small>
              )}
            </label>

            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={autoPrintReceipt}
                disabled={receiptSaving || printerLoading}
                onChange={(event) => setAutoPrintReceipt(event.target.checked)}
              />
              <span>
                <strong>Print automatically after checkout</strong>
                <small>Printing starts after the sale has been saved.</small>
              </span>
            </label>

            {receiptError && (
              <p className="product-banner-error" role="alert">
                {receiptError}
              </p>
            )}
            {receiptNotice && (
              <p className="settings-notice" role="status">
                {receiptNotice}
              </p>
            )}
            <div className="settings-actions">
              <button
                className="primary-button"
                type="submit"
                disabled={receiptSaving || printerLoading}
                onClick={() => void saveReceiptSettings()}
              >
                {receiptSaving ? 'Saving…' : 'Save receipt settings'}
              </button>
            </div>
          </form>
        )}
      </section>
    </section>
  )
}

function formatTaxRate(basisPoints: number): string {
  return (basisPoints / 100).toFixed(2)
}

export default SettingsScreen

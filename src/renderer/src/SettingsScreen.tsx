import { useCallback, useEffect, useState } from 'react'
import type { PrinterOption } from '../../shared/pos-api'

function SettingsScreen(): React.JSX.Element {
  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError('')
    setNotice('')
    try {
      const [printerResult, settingsResult] = await Promise.all([
        window.pos.printers.list(),
        window.pos.settings.getReceipt()
      ])
      if (printerResult.ok) setPrinters(printerResult.data)
      else setError(printerResult.error.message)

      if (settingsResult.ok) {
        setPrinterName(settingsResult.data.printerName)
        setAutoPrintReceipt(settingsResult.data.autoPrintReceipt)
      } else {
        setError(settingsResult.error.message)
      }
    } catch {
      setError('Receipt settings could not be loaded. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadSettings)
  }, [loadSettings])

  async function saveSettings(): Promise<void> {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await window.pos.settings.saveReceipt({ printerName, autoPrintReceipt })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setPrinterName(result.data.printerName)
      setAutoPrintReceipt(result.data.autoPrintReceipt)
      setNotice('Receipt settings saved.')
    } catch {
      setError('Receipt settings could not be saved. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const unavailableSavedPrinter =
    printerName !== null && !printers.some((printer) => printer.name === printerName)

  return (
    <section className="settings-page" aria-label="Settings">
      <div className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Receipt</h2>
            <p className="settings-copy">
              Choose where receipts print. The printer driver controls the paper size; use an 80 mm
              receipt setting for this register.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={loading || saving}
            onClick={() => void loadSettings()}
          >
            Refresh printers
          </button>
        </div>

        {loading ? (
          <p className="settings-state" role="status">
            Loading receipt settings…
          </p>
        ) : (
          <div className="settings-form">
            <label className="settings-field" htmlFor="receipt-printer">
              <span>Receipt printer</span>
              <select
                id="receipt-printer"
                value={printerName ?? ''}
                disabled={saving}
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
                disabled={saving}
                onChange={(event) => setAutoPrintReceipt(event.target.checked)}
              />
              <span>
                <strong>Print automatically after checkout</strong>
                <small>Printing starts after the sale has been saved.</small>
              </span>
            </label>

            {error && (
              <p className="product-banner-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="settings-notice" role="status">
                {notice}
              </p>
            )}
            <div className="settings-actions">
              <button
                className="primary-button"
                type="button"
                disabled={saving}
                onClick={() => void saveSettings()}
              >
                {saving ? 'Saving…' : 'Save receipt settings'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export default SettingsScreen

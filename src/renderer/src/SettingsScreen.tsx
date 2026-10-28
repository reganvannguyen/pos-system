import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BusinessSettingsInput,
  BusinessSettingsField,
  BackupStatus,
  PrinterOption,
  TaxRate,
  TaxRateInput,
  TaxSettingsField
} from '../../shared/pos-api'
import { renderReceiptPreviewHtml } from '../../shared/receipt-html'

const emptyBusinessSettings: BusinessSettingsInput = {
  businessName: '',
  businessAddress: '',
  businessCity: '',
  businessProvince: '',
  businessPostalCode: '',
  businessPhone: '',
  businessEmail: '',
  businessGstNumber: '',
  businessWebsite: ''
}

function SettingsScreen(): React.JSX.Element {
  const [businessDetails, setBusinessDetails] =
    useState<BusinessSettingsInput>(emptyBusinessSettings)
  const [businessLoading, setBusinessLoading] = useState(true)
  const [businessLoaded, setBusinessLoaded] = useState(false)
  const [businessSaving, setBusinessSaving] = useState(false)
  const [businessError, setBusinessError] = useState('')
  const [businessFieldErrors, setBusinessFieldErrors] = useState<
    Partial<Record<BusinessSettingsField, string>>
  >({})
  const [businessNotice, setBusinessNotice] = useState('')

  const [taxes, setTaxes] = useState<TaxRateInput[]>([])
  const [taxLoading, setTaxLoading] = useState(true)
  const [taxLoaded, setTaxLoaded] = useState(false)
  const [taxSaving, setTaxSaving] = useState(false)
  const [taxError, setTaxError] = useState('')
  const [taxFieldErrors, setTaxFieldErrors] = useState<
    Record<number, Partial<Record<TaxSettingsField, string>>>
  >({})
  const [taxNotice, setTaxNotice] = useState('')

  const [printers, setPrinters] = useState<PrinterOption[]>([])
  const [printerName, setPrinterName] = useState<string | null>(null)
  const [receiptLoading, setReceiptLoading] = useState(true)
  const [printerLoading, setPrinterLoading] = useState(false)
  const [receiptLoaded, setReceiptLoaded] = useState(false)
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [testPrinting, setTestPrinting] = useState(false)
  const [receiptError, setReceiptError] = useState('')
  const [receiptNotice, setReceiptNotice] = useState('')

  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null)
  const [backupLoading, setBackupLoading] = useState(true)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState('')
  const [backupNotice, setBackupNotice] = useState('')

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
      setBusinessDetails(result.data)
      setBusinessLoaded(true)
    } catch {
      setBusinessError('Receipt details could not be loaded. Try again.')
    } finally {
      setBusinessLoading(false)
    }
  }, [])

  const loadTaxSettings = useCallback(async (): Promise<void> => {
    setTaxLoading(true)
    setTaxError('')
    setTaxNotice('')
    try {
      const result = await window.pos.settings.getTaxes()
      if (!result.ok) {
        setTaxError(result.error.message)
        return
      }
      setTaxes(result.data.map(toTaxInput))
      setTaxLoaded(true)
    } catch {
      setTaxError('Tax settings could not be loaded. Try again.')
    } finally {
      setTaxLoading(false)
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

  const loadBackupStatus = useCallback(async (): Promise<void> => {
    setBackupLoading(true)
    setBackupError('')
    try {
      const result = await window.pos.backups.getStatus()
      if (!result.ok) {
        setBackupError(result.error.message)
        return
      }
      setBackupStatus(result.data)
    } catch {
      setBackupError('Backup settings could not be loaded. Try again.')
    } finally {
      setBackupLoading(false)
    }
  }, [])

  const refreshBackupStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await window.pos.backups.getStatus()
      if (result.ok) setBackupStatus(result.data)
    } catch {
      // Keep the last known backup status visible if a refresh fails.
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
    void Promise.resolve().then(loadTaxSettings)
    void Promise.resolve().then(loadReceiptSettings)
    void Promise.resolve().then(loadBackupStatus)
  }, [loadBackupStatus, loadBusinessSettings, loadReceiptSettings, loadTaxSettings])

  useEffect(() => {
    const interval = window.setInterval(() => void refreshBackupStatus(), 60_000)
    return () => window.clearInterval(interval)
  }, [refreshBackupStatus])

  async function saveBusinessSettings(): Promise<void> {
    setBusinessSaving(true)
    setBusinessError('')
    setBusinessFieldErrors({})
    setBusinessNotice('')
    try {
      const result = await window.pos.settings.saveBusiness(businessDetails)
      if (!result.ok) {
        if (result.error.field) {
          setBusinessFieldErrors({ [result.error.field]: result.error.message })
        } else {
          setBusinessError(result.error.message)
        }
        return
      }
      setBusinessDetails(result.data)
      setBusinessLoaded(true)
      setBusinessNotice('Receipt details saved.')
    } catch {
      setBusinessError('Receipt details could not be saved. Try again.')
    } finally {
      setBusinessSaving(false)
    }
  }

  async function saveTaxSettings(): Promise<void> {
    setTaxSaving(true)
    setTaxError('')
    setTaxFieldErrors({})
    setTaxNotice('')
    try {
      const result = await window.pos.settings.saveTaxes({ taxes })
      if (!result.ok) {
        if (result.error.index !== undefined && result.error.field) {
          setTaxFieldErrors({
            [result.error.index]: { [result.error.field]: result.error.message }
          })
        } else {
          setTaxError(result.error.message)
        }
        return
      }
      setTaxes(result.data.map(toTaxInput))
      setTaxLoaded(true)
      setTaxNotice('Tax settings saved.')
    } catch {
      setTaxError('Tax settings could not be saved. Try again.')
    } finally {
      setTaxSaving(false)
    }
  }

  function clearTaxRowError(index: number, field: TaxSettingsField): void {
    setTaxFieldErrors((current) => ({
      ...current,
      [index]: { ...current[index], [field]: undefined }
    }))
    setTaxError('')
    setTaxNotice('')
  }

  function updateBusinessField(field: BusinessSettingsField, value: string): void {
    setBusinessDetails((current) => ({ ...current, [field]: value }))
    setBusinessFieldErrors((current) => ({ ...current, [field]: undefined }))
    setBusinessError('')
    setBusinessNotice('')
  }

  async function printTestReceipt(): Promise<void> {
    setTestPrinting(true)
    setReceiptError('')
    setReceiptNotice('')
    try {
      const result = await window.pos.receipts.printTest()
      if (!result.ok) setReceiptError(result.error.message)
      else
        setReceiptNotice(
          'Test receipt sent to the saved printer. Check both edges, the store name, and the full invoice number.'
        )
    } catch {
      setReceiptError('Test receipt could not be printed. Try again.')
    } finally {
      setTestPrinting(false)
    }
  }

  async function saveReceiptSettings(): Promise<void> {
    setReceiptSaving(true)
    setReceiptError('')
    setReceiptNotice('')
    try {
      const result = await window.pos.settings.saveReceipt({ printerName })
      if (!result.ok) {
        setReceiptError(result.error.message)
        return
      }
      setPrinterName(result.data.printerName)
      setReceiptNotice('Receipt settings saved.')
    } catch {
      setReceiptError('Receipt settings could not be saved. Try again.')
    } finally {
      setReceiptSaving(false)
    }
  }

  async function chooseBackupDestination(): Promise<void> {
    setBackupBusy(true)
    setBackupError('')
    setBackupNotice('')
    try {
      const previousPath = backupStatus?.destinationPath
      const result = await window.pos.backups.chooseDestination()
      if (!result.ok) {
        setBackupError(result.error.message)
        return
      }
      setBackupStatus(result.data)
      if (previousPath !== result.data.destinationPath) {
        setBackupNotice('Backup folder saved. Automatic backups are enabled.')
      }
    } catch {
      setBackupError('The backup folder could not be saved. Try again.')
    } finally {
      setBackupBusy(false)
    }
  }

  async function runManualBackup(): Promise<void> {
    setBackupBusy(true)
    setBackupError('')
    setBackupNotice('')
    try {
      const result = await window.pos.backups.runManual()
      if (!result.ok) {
        await refreshBackupStatus()
        setBackupError(result.error.message)
        return
      }
      setBackupStatus(result.data)
      setBackupNotice('Backup created successfully.')
    } catch {
      setBackupError('The backup could not be created. Check the backup drive and try again.')
    } finally {
      setBackupBusy(false)
    }
  }

  async function restoreBackup(): Promise<void> {
    setBackupBusy(true)
    setBackupError('')
    setBackupNotice('')
    try {
      const result = await window.pos.backups.restore()
      if (!result.ok) {
        setBackupError(result.error.message)
      } else if (result.data.restored) {
        setBackupNotice('Backup restored. The app is restarting.')
      }
    } catch {
      setBackupError('The backup could not be restored. Try again.')
    } finally {
      setBackupBusy(false)
    }
  }

  const unavailableSavedPrinter =
    printerName !== null && !printers.some((printer) => printer.name === printerName)
  const receiptPreviewHtml = useMemo(
    () => renderReceiptPreviewHtml(businessDetails),
    [businessDetails]
  )

  return (
    <section className="settings-page" aria-label="Settings">
      <section
        className="settings-card receipt-details-card"
        aria-labelledby="receipt-details-title"
      >
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Customer receipt</p>
            <h2 id="receipt-details-title">Receipt details</h2>
            <p className="settings-copy">
              Update the store information printed on receipts. The preview reflects unsaved edits.
            </p>
          </div>
        </div>

        <div className="receipt-details-layout">
          <div>
            {businessLoading ? (
              <p className="settings-state" role="status">
                Loading receipt details…
              </p>
            ) : !businessLoaded ? (
              <div className="settings-state settings-load-error" role="alert">
                <p>{businessError || 'Receipt details could not be loaded.'}</p>
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
                className="settings-form receipt-details-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveBusinessSettings()
                }}
              >
                <BusinessTextField
                  id="business-name"
                  label="Company name"
                  autoComplete="organization"
                  value={businessDetails.businessName}
                  error={businessFieldErrors.businessName}
                  disabled={businessSaving}
                  onChange={(value) => updateBusinessField('businessName', value)}
                />
                <div className="receipt-location-group">
                  <p className="receipt-fields-heading">Store location</p>
                  <BusinessTextField
                    id="business-address"
                    label="Address"
                    autoComplete="street-address"
                    value={businessDetails.businessAddress}
                    disabled={businessSaving}
                    onChange={(value) => updateBusinessField('businessAddress', value)}
                  />
                  <div className="receipt-locality-grid">
                    <BusinessTextField
                      id="business-city"
                      label="City"
                      autoComplete="address-level2"
                      value={businessDetails.businessCity}
                      disabled={businessSaving}
                      onChange={(value) => updateBusinessField('businessCity', value)}
                    />
                    <BusinessTextField
                      id="business-province"
                      label="Province"
                      autoComplete="address-level1"
                      value={businessDetails.businessProvince}
                      disabled={businessSaving}
                      onChange={(value) => updateBusinessField('businessProvince', value)}
                    />
                    <BusinessTextField
                      id="business-postal-code"
                      label="Postal code"
                      autoComplete="postal-code"
                      value={businessDetails.businessPostalCode}
                      disabled={businessSaving}
                      onChange={(value) => updateBusinessField('businessPostalCode', value)}
                    />
                  </div>
                </div>
                <BusinessTextField
                  id="business-phone"
                  label="Phone number (optional)"
                  type="tel"
                  autoComplete="tel"
                  value={businessDetails.businessPhone}
                  disabled={businessSaving}
                  onChange={(value) => updateBusinessField('businessPhone', value)}
                />
                <BusinessTextField
                  id="business-email"
                  label="Contact email (optional)"
                  type="email"
                  autoComplete="email"
                  value={businessDetails.businessEmail}
                  error={businessFieldErrors.businessEmail}
                  helperText="The email app selects the sending account."
                  disabled={businessSaving}
                  onChange={(value) => updateBusinessField('businessEmail', value)}
                />
                <BusinessTextField
                  id="business-gst-number"
                  label="GST/HST number (optional)"
                  value={businessDetails.businessGstNumber}
                  disabled={businessSaving}
                  onChange={(value) => updateBusinessField('businessGstNumber', value)}
                />
                <BusinessTextField
                  id="business-website"
                  label="Website (optional)"
                  type="text"
                  autoComplete="url"
                  value={businessDetails.businessWebsite}
                  disabled={businessSaving}
                  onChange={(value) => updateBusinessField('businessWebsite', value)}
                />
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
                  <button className="primary-button" type="submit" disabled={businessSaving}>
                    {businessSaving ? 'Saving…' : 'Save receipt details'}
                  </button>
                </div>
              </form>
            )}
          </div>
          <aside className="receipt-preview-panel" aria-labelledby="receipt-preview-title">
            <h3 id="receipt-preview-title">Live receipt preview</h3>
            <iframe
              className="receipt-preview-frame"
              title="Sample 58 millimetre receipt preview"
              sandbox="allow-same-origin"
              srcDoc={receiptPreviewHtml}
            />
            <small className="settings-help">Sample invoice and items shown for layout only.</small>
          </aside>
        </div>
      </section>

      <section className="settings-card" aria-labelledby="tax-settings-title">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Checkout</p>
            <h2 id="tax-settings-title">Tax</h2>
            <p className="settings-copy">
              Add each tax charged in your store. Every rate is calculated on the pre-tax subtotal.
            </p>
          </div>
          {taxLoaded && (
            <button
              className="secondary-button"
              type="button"
              disabled={taxSaving}
              onClick={() => {
                setTaxes((current) => [...current, { name: '', ratePercent: '' }])
                setTaxFieldErrors({})
                setTaxError('')
                setTaxNotice('')
              }}
            >
              Add tax
            </button>
          )}
        </div>

        {taxLoading ? (
          <p className="settings-state" role="status">
            Loading tax settings…
          </p>
        ) : !taxLoaded ? (
          <div className="settings-state settings-load-error" role="alert">
            <p>{taxError || 'Tax settings could not be loaded.'}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadTaxSettings()}
            >
              Retry
            </button>
          </div>
        ) : (
          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault()
              void saveTaxSettings()
            }}
          >
            {taxes.length === 0 ? (
              <p className="settings-state">
                No taxes configured. Add a tax to include it at checkout.
              </p>
            ) : (
              <div className="tax-rate-list">
                {taxes.map((tax, index) => (
                  <div className="tax-rate-row" key={tax.id ?? `new-${index}`}>
                    <label className="settings-field" htmlFor={`tax-name-${index}`}>
                      <span>Tax name</span>
                      <input
                        id={`tax-name-${index}`}
                        type="text"
                        maxLength={60}
                        value={tax.name}
                        disabled={taxSaving}
                        aria-invalid={Boolean(taxFieldErrors[index]?.name)}
                        aria-describedby={
                          taxFieldErrors[index]?.name ? `tax-name-error-${index}` : undefined
                        }
                        onChange={(event) => {
                          setTaxes((current) =>
                            current.map((entry, row) =>
                              row === index ? { ...entry, name: event.target.value } : entry
                            )
                          )
                          clearTaxRowError(index, 'name')
                        }}
                      />
                      {taxFieldErrors[index]?.name && (
                        <small
                          id={`tax-name-error-${index}`}
                          className="settings-help is-error"
                          role="alert"
                        >
                          {taxFieldErrors[index]?.name}
                        </small>
                      )}
                    </label>
                    <label className="settings-field" htmlFor={`tax-rate-${index}`}>
                      <span>Rate</span>
                      <div className="settings-percent-input">
                        <input
                          id={`tax-rate-${index}`}
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={tax.ratePercent}
                          disabled={taxSaving}
                          aria-invalid={Boolean(taxFieldErrors[index]?.ratePercent)}
                          aria-describedby={
                            taxFieldErrors[index]?.ratePercent
                              ? `tax-rate-error-${index}`
                              : undefined
                          }
                          onChange={(event) => {
                            setTaxes((current) =>
                              current.map((entry, row) =>
                                row === index
                                  ? { ...entry, ratePercent: event.target.value }
                                  : entry
                              )
                            )
                            clearTaxRowError(index, 'ratePercent')
                          }}
                        />
                        <span aria-hidden="true">%</span>
                      </div>
                      {taxFieldErrors[index]?.ratePercent && (
                        <small
                          id={`tax-rate-error-${index}`}
                          className="settings-help is-error"
                          role="alert"
                        >
                          {taxFieldErrors[index]?.ratePercent}
                        </small>
                      )}
                    </label>
                    <button
                      className="text-button danger-text tax-remove-button"
                      type="button"
                      disabled={taxSaving}
                      aria-label={`Remove ${tax.name || `tax ${index + 1}`}`}
                      onClick={() => {
                        setTaxes((current) => current.filter((_, row) => row !== index))
                        setTaxFieldErrors({})
                        setTaxNotice('')
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <small className="settings-help">
              Enter rates from 0% to 100%, with up to two decimal places.
            </small>
            {taxError && (
              <p className="product-banner-error" role="alert">
                {taxError}
              </p>
            )}
            {taxNotice && (
              <p className="settings-notice" role="status">
                {taxNotice}
              </p>
            )}
            <div className="settings-actions">
              <button className="primary-button" type="submit" disabled={taxSaving}>
                {taxSaving ? 'Saving…' : 'Save tax settings'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="settings-card" aria-labelledby="receipt-settings-title">
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Register hardware</p>
            <h2 id="receipt-settings-title">Receipt printer</h2>
            <p className="settings-copy">
              Choose the printer used when staff select Print after checkout. The driver controls
              paper size; use 58 mm paper. Receipts fit its 48 mm printable area.
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
                disabled={receiptSaving || printerLoading || testPrinting}
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

            <p className="settings-help">
              Test printing uses saved printer and store details. Save changes first.
            </p>
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
                disabled={receiptSaving || printerLoading || testPrinting}
              >
                {receiptSaving ? 'Saving…' : 'Save receipt settings'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={testPrinting || receiptSaving || printerLoading}
                onClick={() => void printTestReceipt()}
              >
                {testPrinting ? 'Printing…' : 'Print test receipt'}
              </button>
            </div>
          </form>
        )}
      </section>

      <section
        className="settings-card backup-settings-card"
        aria-labelledby="backup-settings-title"
      >
        <div className="settings-card-heading">
          <div>
            <p className="eyebrow">Data protection</p>
            <h2 id="backup-settings-title">Backup and Restore</h2>
            <p className="settings-copy">
              Save the full register to another drive each night at 2:00 AM. If the app misses that
              time while closed, it backs up the next time it starts. Automatic backups are kept for
              90 days; manual backups are kept until you remove them.
            </p>
          </div>
        </div>

        {backupLoading ? (
          <p className="settings-state" role="status">
            Loading backup settings…
          </p>
        ) : (
          <div className="backup-settings-content">
            <div className="backup-destination">
              <strong>Backup folder</strong>
              <span>{backupStatus?.destinationPath ?? 'Not selected'}</span>
            </div>
            {!backupStatus?.destinationPath && (
              <p className="settings-help">
                Choose a folder on a separate drive to enable backups.
              </p>
            )}
            {backupStatus?.lastAttemptStatus === 'failed' && (
              <p className="product-banner-error" role="alert">
                Last backup attempt failed: {backupStatus.lastAttemptError}
              </p>
            )}
            {backupStatus?.lastBackupAt && (
              <p className="backup-last-success" role="status">
                Last successful backup: {new Date(backupStatus.lastBackupAt).toLocaleString()} (
                {backupStatus.lastBackupKind})
              </p>
            )}
            {!backupStatus?.lastBackupAt && backupStatus?.lastAttemptStatus !== 'failed' && (
              <p className="settings-help">No backup has been created yet.</p>
            )}
            {backupError && backupError !== backupStatus?.lastAttemptError && (
              <p className="product-banner-error" role="alert">
                {backupError}
              </p>
            )}
            {backupNotice && (
              <p className="settings-notice" role="status">
                {backupNotice}
              </p>
            )}
            <div className="settings-actions backup-settings-actions">
              <button
                className="secondary-button"
                type="button"
                disabled={backupBusy}
                onClick={() => void restoreBackup()}
              >
                Restore from backup
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={backupBusy}
                onClick={() => void chooseBackupDestination()}
              >
                {backupStatus?.destinationPath ? 'Change backup folder' : 'Choose backup folder'}
              </button>
              <button
                className="primary-button"
                type="button"
                disabled={backupBusy || !backupStatus?.destinationPath}
                onClick={() => void runManualBackup()}
              >
                {backupBusy ? 'Working…' : 'Back up now'}
              </button>
            </div>
          </div>
        )}
      </section>
    </section>
  )
}

function toTaxInput(tax: TaxRate): TaxRateInput {
  return { id: tax.id, name: tax.name, ratePercent: (tax.rateBasisPoints / 100).toFixed(2) }
}

interface BusinessTextFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'tel'
  autoComplete?: string
  disabled?: boolean
  error?: string
  helperText?: string
}

function BusinessTextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  disabled = false,
  error,
  helperText
}: BusinessTextFieldProps): React.JSX.Element {
  const errorId = `${id}-error`
  return (
    <label className="settings-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={type}
        required={id === 'business-name'}
        autoComplete={autoComplete}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {helperText && <small className="settings-help">{helperText}</small>}
      {error && (
        <small id={errorId} className="settings-help is-error" role="alert">
          {error}
        </small>
      )}
    </label>
  )
}

export default SettingsScreen

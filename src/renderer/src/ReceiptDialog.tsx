import { useEffect, useRef, useState } from 'react'
import type { SaleDetail } from '../../shared/pos-api'

const currencyFormatter = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD'
})

type ReceiptAction = 'choose' | 'email' | 'text'

interface ReceiptDialogProps {
  sale: SaleDetail
  onClose: () => void
}

function ReceiptDialog({ sale, onClose }: ReceiptDialogProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [action, setAction] = useState<ReceiptAction>('choose')
  const [email, setEmail] = useState(sale.charge?.customer.email ?? '')
  const [phone, setPhone] = useState(sale.charge?.customer.phoneNumber ?? '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [emailDraft, setEmailDraft] = useState<{
    subject: string
    body: string
    attachmentIncluded: boolean
    draftOpened: boolean
  } | null>(null)
  const [textMessage, setTextMessage] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      if (dialog?.open) dialog.close()
    }
  }, [])

  function choose(next: ReceiptAction): void {
    setAction(next)
    setError('')
    setNotice('')
    setEmailDraft(null)
    setTextMessage('')
  }

  async function print(): Promise<void> {
    if (working) return
    setWorking(true)
    setError('')
    setNotice('')
    try {
      const result = await window.pos.receipts.print(sale.id)
      if (!result.ok) {
        setError(result.error.message)
      } else {
        setNotice(
          sale.transactionType === 'return' ? 'Return receipt printed.' : 'Receipt printed.'
        )
      }
    } catch {
      setError('Receipt could not be printed. The saved transaction is still available.')
    } finally {
      setWorking(false)
    }
  }

  async function openEmailDraft(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError('')
    setNotice('')
    setEmailDraft(null)
    try {
      const result = await window.pos.receipts.emailDraft(sale.id, email)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setEmailDraft(result.data)
      if (!result.data.draftOpened) {
        setNotice('No email app opened. Copy the message below and attach the receipt PDF.')
      } else if (!result.data.attachmentIncluded) {
        setNotice(
          'Email compose opened. Attach the receipt PDF before sending; the POS cannot verify delivery.'
        )
      } else {
        setNotice('Email compose opened with the receipt attached. The POS cannot verify delivery.')
      }
    } catch {
      setError('The email draft could not be prepared. The saved transaction is still available.')
    } finally {
      setWorking(false)
    }
  }

  async function openTextDraft(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (working) return
    setWorking(true)
    setError('')
    setNotice('')
    setTextMessage('')
    try {
      const result = await window.pos.receipts.textDraft(sale.id, phone)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setTextMessage(result.data.message)
      setNotice(
        result.data.draftOpened
          ? 'Messaging compose opened. The POS cannot verify delivery.'
          : 'No messaging app opened. Copy the message below to send it manually.'
      )
    } catch {
      setError('The text message could not be prepared. The saved transaction is still available.')
    } finally {
      setWorking(false)
    }
  }

  async function showPdf(): Promise<void> {
    setWorking(true)
    setError('')
    try {
      const result = await window.pos.receipts.openPdf(sale.id)
      if (!result.ok) setError(result.error.message)
      else setNotice('Receipt PDF opened in its folder. Attach it to the email draft.')
    } catch {
      setError('The receipt PDF could not be opened.')
    } finally {
      setWorking(false)
    }
  }

  async function copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Copied to clipboard.')
    } catch {
      setError('Clipboard access failed. Select and copy the message text manually.')
    }
  }

  return (
    <dialog
      className="product-dialog checkout-dialog receipt-dialog"
      ref={dialogRef}
      aria-labelledby="receipt-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!working) onClose()
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">
            {sale.transactionType === 'return' ? 'Return' : 'Invoice'} #{sale.transactionNumber} ·{' '}
            {currencyFormatter.format(sale.totalCents / 100)}
          </p>
          <h2 id="receipt-dialog-title">
            {action === 'choose'
              ? 'Receipt options'
              : action === 'email'
                ? 'Email receipt'
                : 'Text receipt'}
          </h2>
        </div>
        <button
          className="dialog-close-button"
          type="button"
          aria-label="Close receipt options"
          disabled={working}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {action === 'choose' ? (
        <div className="receipt-choice-actions">
          <button
            className="primary-button"
            type="button"
            autoFocus
            disabled={working}
            onClick={() => void print()}
          >
            {working
              ? 'Printing…'
              : sale.transactionType === 'return'
                ? 'Print return receipt'
                : 'Print receipt'}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={working}
            onClick={() => choose('email')}
          >
            Email PDF
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={working}
            onClick={() => choose('text')}
          >
            Text summary
          </button>
          <button
            className="text-button receipt-done-button"
            type="button"
            disabled={working}
            onClick={onClose}
          >
            Done
          </button>
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
        </div>
      ) : action === 'email' ? (
        <form className="receipt-action-content" onSubmit={(event) => void openEmailDraft(event)}>
          <label className="settings-field" htmlFor="receipt-email-recipient">
            <span>Customer email</span>
            <input
              id="receipt-email-recipient"
              autoFocus
              type="email"
              required
              autoComplete="email"
              value={email}
              disabled={working}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <p className="settings-help">The customer’s email address is used for this draft only.</p>
          {emailDraft && (
            <div className="receipt-draft-preview">
              <label>
                <span>Email subject</span>
                <input readOnly value={emailDraft.subject} />
              </label>
              <label>
                <span>Email message</span>
                <textarea readOnly rows={3} value={emailDraft.body} />
              </label>
              {!emailDraft.attachmentIncluded && (
                <div className="receipt-fallback-actions">
                  <button className="secondary-button" type="button" onClick={() => void showPdf()}>
                    Show receipt PDF
                  </button>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => void copy(`${emailDraft.subject}\n\n${emailDraft.body}`)}
                  >
                    Copy email details
                  </button>
                </div>
              )}
            </div>
          )}
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
          <div className="dialog-actions checkout-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={working}
              onClick={() => choose('choose')}
            >
              Back
            </button>
            <button className="primary-button" type="submit" disabled={working}>
              {working ? 'Preparing email…' : 'Open email draft'}
            </button>
          </div>
        </form>
      ) : (
        <form className="receipt-action-content" onSubmit={(event) => void openTextDraft(event)}>
          <label className="settings-field" htmlFor="receipt-phone-recipient">
            <span>Customer phone number</span>
            <input
              id="receipt-phone-recipient"
              autoFocus
              type="tel"
              required
              autoComplete="tel"
              value={phone}
              disabled={working}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <p className="settings-help">The customer’s number is used for this draft only.</p>
          {textMessage && (
            <div className="receipt-draft-preview">
              <label>
                <span>Message</span>
                <textarea readOnly rows={3} value={textMessage} />
              </label>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copy(textMessage)}
              >
                Copy message
              </button>
            </div>
          )}
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
          <div className="dialog-actions checkout-dialog-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={working}
              onClick={() => choose('choose')}
            >
              Back
            </button>
            <button className="primary-button" type="submit" disabled={working}>
              {working ? 'Opening message…' : 'Open text message'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}

export default ReceiptDialog

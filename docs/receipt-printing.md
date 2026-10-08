# Receipt Settings and Delivery

## 1. Goal

Receipts are generated from a completed transaction already stored in SQLite. After each successful sale or return,
the cashier can print, prepare an email, prepare a text, or finish without a receipt. Receipt failures
must never undo a sale.

## 2. Saved Receipt Data

Build each receipt from the sale snapshots and current saved receipt details:

- Company name, address, city, province, postal code, phone, contact email, GST/HST number, and
  website. Optional details are omitted when blank.
- Persisted invoice or return number, local date in `DD/MM/YY` format, local time in 12-hour format,
  subtotal, tax lines, and total.
- Historical item names, SKUs, quantities, prices, and line totals.
- Total tendered, change due, payment type, and saved tax snapshots.

Do not show transaction price-override reasons on receipts. Customer email addresses and phone
numbers are used for a single compose attempt and are not stored in the POS database.

Settings provides a live 58 mm sample preview that reflects unsaved receipt-detail edits. The same
escaped HTML template is used for preview, printing, and PDFs. Preview data is fictional and is not
saved as a transaction.

## 3. Post-Sale Receipt Choices

After the sale commit succeeds, clear the cart and open the receipt dialog. The dialog offers Print,
Email, Text, and Done. It is also available from Sales History so staff can prepare another copy.

### Print

Use the selected Windows printer and existing 58 mm layout. If no printer is selected or printing
fails, keep the saved sale and offer the action again from Sales History.

### Email

Ask for the customer's email address and generate a PDF using the saved sale. On Windows, use the
default MAPI mail client to open a draft with the PDF attached when supported. If attachment
handoff is unavailable, open a normal email draft and let the cashier open the PDF from its folder
to attach it. The sending account is controlled by the mail client; the business email in Settings
is a store contact shown on the receipt.

### Text

Ask for a phone number and prepare a short message containing the store name, invoice number,
date/time, and total. Open the operating system's messaging composer when available. If no app can
open the draft, show the message with a Copy action. The POS does not send or track delivery.

## 4. PDF and Printer Layout

Use the escaped 58 mm thermal layout for printer and PDF output. The PDF uses a content-driven
height. Historical reprints use the latest saved store details together with the original sale's
item, tax, and tender snapshots. No receipt reason, customer contact data, or live product data is
added to the PDF.

## 5. Errors and Recovery

- Printing, PDF generation, or app-launch failure leaves the sale saved.
- Retry failed actions from the receipt dialog or reopen the same choices in Sales History.
- If an email draft cannot be opened, keep the PDF accessible and show the subject/body for copying.
- If a text composer cannot be opened, show the prepared message for copying.
- Say when a compose app opened, but never claim that a message was sent or delivered.

No automatic printing or online sending service is used.

Receipts use the persisted `YYYYMMDD-0001` transaction number, labeled Invoice No. for sales and
Return No. for returns. Return receipts show negative item, tax, total, and refund amounts. The
internal return reason is excluded from printed and emailed receipts.

# Requirements

## 1. Purpose

The POS system is a local Windows desktop application for completing basic retail sales quickly without requiring an internet connection or external backend.

## 2. MVP Functional Requirements

### Product Management

The user must be able to:

- Create a product.
- Assign a unique SKU/code to a product.
- Normalize SKUs by trimming surrounding whitespace and converting to uppercase.
- Set the product name and price.
- Optionally track stock quantity.
- Edit an existing product.
- Change a product's SKU; its previous SKU becomes available.
- Deactivate a product without freeing its current SKU.
- Reactivate a deactivated product.

### POS / Checkout

The cashier must be able to:

- Type a SKU/code and press Enter to add the matching product to the cart.
- See an error when a SKU does not exist.
- Add the same product multiple times, increasing its quantity.
- Change an item's quantity.
- Remove an item from the cart.
- See subtotal, tax, and total update immediately.
- Edit a cart line's price for the current transaction by selecting its price, entering a new CAD amount and a required reason, and confirming the change.
- Record one or more payments as Cash, Debit, or Credit, including partial amounts.
- See the amount paid, remaining balance, and any cash change due; only cash may exceed the remaining balance.
- Complete a sale after the total is covered. An incomplete payment session can be resumed or explicitly discarded without losing the cart.

Card payments in the MVP record tender type and amount only. The application does not process a bank card transaction. A transaction price override does not change the product's catalog price.

### Standalone Returns

The register must provide a Return mode that records a return as a separate transaction. It does not link to an invoice or validate the original purchase.

- Scan active or inactive products and use their current catalog prices and tax settings.
- Keep returned quantities positive while showing return prices, taxes, and totals as negative amounts.
- Require a non-empty internal reason. Show it in transaction details and CSV, but never on a customer receipt.
- Offer an unchecked-by-default restock choice on each line. Restock only tracked inventory and save the result with the return.
- Record split Cash, Debit, or Credit payouts. Payouts must equal the return total exactly; do not allow change or overpayment. Card refunds are recorded for history and processed separately on the payment terminal.
- Allow zero-total returns with at least one item and a reason, without a payout.
- Save the return, tax snapshots, payouts, and inventory changes atomically. Preserve the cart and staged payouts if saving fails.
- Show returns in history as Return # transactions. Reports must show gross sales, negative returns, net amounts, and Cash/Card received, refunded, and net totals.
- Give each sale and return a persisted customer-facing number in `YYYYMMDD-0001` format, with one daily sequence shared across both transaction types.

### Sales History

For every completed sale, the system must store:

- Sale identifier.
- Date and time.
- Subtotal.
- Tax.
- Total.
- Payment method.
- Products sold.
- SKU used at the time of sale.
- Product name at the time of sale.
- Unit price at the time of sale.
- Original catalog price when a transaction price override was used, plus the required reason.
- Quantity sold.
- Each payment type, tendered amount, applied amount, and cash change.

Historical sales must not change when a product is later renamed or repriced.

Sales history must support day, month, year, and custom date-range filters. It must summarize sales and returns for the selected period, and export one CSV row per transaction, including signed amounts, tender breakdown, and return reason when applicable.

### Receipt Delivery

After a completed sale or return, the cashier must be able to:

- Choose Print, Email, Text, or Done from a receipt dialog.
- Print through a Windows-installed printer selected in Settings.
- Prepare an email draft with a PDF receipt attached when the mail client supports attachments.
- Prepare a short text draft in the computer's messaging app.
- Reopen the same receipt choices from Sales History.
- Keep completed transactions saved when printing or opening a draft fails.
- Enter the recipient for each email/text attempt without saving customer contact details.

### Settings

The user must be able to configure at least:

- Store/business name.
- Optional store contact email.
- Named tax rates, including multiple rates applied independently to the pre-tax subtotal.
- Receipt printer.

## 3. Non-Functional Requirements

### Windows Desktop Application

The production application must:

- Launch from a normal Windows shortcut or Start Menu entry.
- Be distributable with a Windows installer.
- Not require the end user to install Node.js, npm, SQLite, Docker, or development tools.
- Store application data outside the installed program files.

### Offline Operation

Core functionality must work without internet access, including:

- Product lookup.
- Checkout.
- Sales history.
- Settings.
- Receipt printing.

### Data Integrity

- A completed sale or return must be written atomically.
- Transaction totals and items must remain consistent.
- Historical prices must be retained.
- SKU values must be unique across all products. Deactivating a product does not free its SKU; reserved SKUs cannot be reused.

### Usability

- The SKU input should receive focus when the POS screen opens.
- After a product is added, focus should return to the SKU input.
- Common checkout actions should require minimal mouse interaction.
- The interface should be usable at typical Windows desktop resolutions.

## 4. Out of Scope for MVP

The initial version will not include:

- Barcode scanning.
- Online accounts.
- Cloud synchronization.
- Multiple registers sharing a database.
- Integrated credit/debit card processing.
- Supplier management.
- Employee roles and permissions.
- Customer loyalty accounts.
- Advanced analytics.
- E-commerce integrations.

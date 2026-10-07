# Requirements

## 1. Purpose

The POS system is a local Windows desktop application for completing basic retail sales quickly without requiring an internet connection or external backend.

## 2. MVP Functional Requirements

### Product Management

The user must be able to:

- Create a product.
- Assign a unique SKU/code to a product.
- Set the product name and price.
- Optionally track stock quantity.
- Edit an existing product.
- Remove or deactivate a product.

### POS / Checkout

The cashier must be able to:

- Type a SKU/code and press Enter to add the matching product to the cart.
- See an error when a SKU does not exist.
- Add the same product multiple times, increasing its quantity.
- Change an item's quantity.
- Remove an item from the cart.
- See subtotal, tax, and total update immediately.
- Select a payment method of Cash or Card.
- Complete a sale.

Card payment in the MVP records the payment method only. The application does not process a bank card transaction.

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
- Quantity sold.

Historical sales must not change when a product is later renamed or repriced.

### Receipt Printing

The system must be able to:

- Generate a receipt from a completed sale.
- Display store information and sale information on the receipt.
- Print through a printer installed in Windows.
- Allow a receipt printer to be selected in Settings.
- Support manual or automatic printing after checkout.

### Settings

The user must be able to configure at least:

- Store/business name.
- Tax rate.
- Receipt printer.
- Automatic receipt printing on/off.

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

- A completed sale must be written atomically.
- Sale totals and sale items must remain consistent.
- Historical prices must be retained.
- SKU values must be unique for active products.

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

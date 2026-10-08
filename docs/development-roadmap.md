# Development Roadmap

## Objective

Build the smallest reliable Windows POS first, then add convenience features after the complete checkout loop works.

## M1 - Project Foundation

Goal: launch a basic Electron + React + TypeScript application locally.

Work:

- Initialize Electron.
- Initialize React + TypeScript.
- Configure development scripts.
- Add secure preload/IPC structure.
- Establish source folder conventions.
- Configure linting/formatting.
- Add initial application shell/navigation.

Done when:

- The desktop window opens locally.
- React renders inside Electron.
- The renderer has no direct Node access.

## M2 - SQLite Foundation

Goal: persist local data safely.

Work:

- Add SQLite library.
- Determine production database path using Electron user data.
- Add migration system.
- Create initial tables.
- Add database initialization on startup.
- Add repository/data-access modules.

Done when:

- App creates the database automatically.
- Schema migrations run automatically.
- Data persists across restarts.

## M3 - Product Management

Goal: maintain the product catalog.

Work:

- Create product.
- Edit product.
- Deactivate product.
- Enforce unique SKU.
- Validate price.
- Optional stock quantity.
- Product list/search screen.

Done when:

- Products can be managed entirely through the UI.
- A SKU lookup returns the correct active product.

## M4 - POS Cart

Goal: build the fast cashier workflow.

Work:

- POS screen.
- Auto-focused SKU input.
- Enter-to-add behavior.
- Unknown SKU error state.
- Increase quantity when SKU is entered repeatedly.
- Quantity controls.
- Remove item.
- Clear cart.
- Calculate subtotal.

Done when:

- A cashier can build a complete cart without leaving the POS screen.

## M5 - Checkout and Sales History

Goal: complete and persist real sales.

Work:

- Tax calculation.
- Cash, Debit, and Credit tenders, including split payments and cash change.
- Transaction-only item price overrides with a reason recorded in Sales History.
- Transactional sale write.
- Save sale item snapshots.
- Optional inventory decrement.
- Clear cart after successful checkout.
- Sales history list.
- Sale detail view.

Done when:

- A completed transaction survives restart.
- Historical item names and prices remain unchanged after product edits.

## M6 - Receipt Printing

Goal: print and reprint receipts.

Work:

- Generate receipt layout.
- Enumerate Windows printers.
- Printer selection setting.
- Manual print.
- Reprint from Sales History.
- Graceful printer error handling.

Done when:

- A completed sale can be printed on a Windows-installed receipt printer.
- Printer failure does not lose the sale.

## M7 - Settings and UX Polish

Goal: make the application comfortable for daily use.

Work:

- Business name.
- One or more named tax rates.
- Printer preference.
- Keyboard-first interaction.
- Loading/error states.
- Confirmation for destructive actions.
- Empty states.
- Basic accessibility.
- Receipt styling.

Done when:

- Normal checkout requires very little mouse use.
- Important configuration persists between launches.

## M8 - Receipt Delivery Choices

Goal: let staff choose how to provide a receipt after a saved sale.

Work:

- Show Print, Email, Text, and Done after every completed sale.
- Generate an itemized receipt PDF from sale snapshots.
- Open email and text drafts in the computer's configured applications.
- Add a store contact email setting.
- Offer the same actions again from Sales History.
- Keep recipient details out of the local database.

Done when:

- Receipt actions never affect a saved sale or stock.
- Draft and file-opening failures have clear recovery paths.

## M9 - Windows Packaging

Goal: deliver the POS like a normal Windows application.

Work:

- Configure electron-builder.
- Application icon.
- Application metadata/version.
- NSIS Windows installer.
- Desktop/Start Menu shortcuts.
- Verify database path after installation.
- Verify printing from packaged build.
- Test install/uninstall on a clean Windows machine.

Done when:

- A user can install from an .exe.
- They can launch from an icon.
- Node.js, npm, Docker, and developer tooling are not required.

## Standalone Returns (Implemented)

This feature was added after the original milestone sequence.

- Return mode accepts active and inactive SKUs at current catalog prices and tax rates.
- Returns have required internal reasons, exact split payouts, and per-line restock choices.
- Return, tax, payout, and tracked-stock writes are atomic.
- History, reports, CSV, and receipt delivery show signed returns and Return # identifiers.
- Migration 007 preserves existing transactions as sales.

Interactive Windows and payment-terminal verification remains part of the release checks.

## M10 - Reliability / Release Candidate

Goal: make the MVP safe enough for actual use.

Work:

- Test interrupted/failed checkout writes.
- Test duplicate SKU behavior.
- Test printer unavailable scenarios.
- Test database migration from previous version.
- Test restart after sales.
- Test tax calculations.
- Add database backup/export option.
- Add basic restore documentation.

Done when:

- Core checkout and history behavior is predictable under common failure cases.

## MVP Release Boundary

The MVP is complete after M10.

Features intentionally deferred:

- Integrated card processing.
- Multi-register sync.
- Cloud accounts.
- Customer loyalty.
- Suppliers.
- Advanced reporting.
- Employee permissions.
- Barcode scanner-specific behavior.

# Architecture

## 1. Overview

The POS is a single-machine Windows desktop application. It does not require a remote backend for the MVP.

```text
Windows Desktop App
       |
       +-- Electron main process
       |      |
       |      +-- SQLite
       |      +-- Windows printing
       |      +-- Windows mail and messaging handoff
       |
       +-- Preload / IPC boundary
       |
       +-- React + TypeScript renderer
```

## 2. Main Components

### React Renderer

Responsible for the user interface:

- POS screen.
- Product management.
- Sales history.
- Standalone returns with exact refund payouts and optional per-line restocking.
- Settings.
- Receipt preview.

The renderer must not access the filesystem or SQLite directly.

### Electron Main Process

Responsible for privileged desktop functionality:

- Opening and managing the SQLite database.
- Running database operations.
- Managing application windows.
- Reading installed printers.
- Printing receipts.
- Creating receipt PDFs and opening email/text drafts in system applications.
- Locating the application's writable data directory.

### Preload / IPC Layer

The preload layer exposes a small, controlled API from Electron to React.

Example responsibilities:

- `products.getBySku(sku)`
- `products.list()`
- `products.create(...)`
- `sales.complete(...)`
- `sales.quoteReturn(...)` and `sales.completeReturn(...)`
- `sales.list()`
- `sales.get(id)`
- `printers.list()`
- `receipts.print(saleId)`
- `settings.get()`
- `settings.update(...)`

React should call these APIs rather than importing Node/Electron modules directly.

### SQLite

SQLite stores all persistent local data:

- Products.
- Customers and their optional image data.
- Sales.
- Sale items.
- Settings.

The production database should live in Electron's per-user application data directory rather than inside the installed application directory.

## 3. Checkout Transaction

A completed checkout should be treated as one database transaction:

```text
Cashier completes sale
        |
        v
Validate cart
        |
        v
BEGIN TRANSACTION
        |
        +-- Insert transaction and item snapshots
        +-- Update stock (if enabled)
        |
        v
COMMIT and clear the cart
        |
        v
Show receipt choices after commit
        |
        +-- Print / open email draft / open text draft
```

If a database write fails before commit, the sale must roll back.

Return completion follows the same atomic boundary. It stores positive database magnitudes with a
`return` transaction type, records exact Cash/Card payouts, and increments only selected tracked
stock. The API and renderer expose signed negative return amounts. A failed return write leaves its
cart and staged payouts available.

Receipt actions happen after the sale is safely stored. Printer, PDF, or external-app failures must
not erase or reverse a valid completed sale.

## 4. Security Boundary

Electron should use:

- `contextIsolation: true`
- A preload script exposing only required functions.
- No direct Node.js access from the React renderer.

This keeps database, filesystem, and printer access behind a controlled IPC boundary.

## 5. Packaging

Development:

```text
React + TypeScript + Electron + SQLite
```

Production:

```text
electron-builder
        |
        v
Windows installer (.exe)
        |
        v
Installed POS application
```

The packaged application contains the runtime and dependencies required by the end user.

## 6. Future Scaling

The local architecture intentionally favors simplicity for one register.

If the system later needs multiple registers, remote access, or centralized reporting, a backend service and shared database can be introduced without changing the core sales concepts.

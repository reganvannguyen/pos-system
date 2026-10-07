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
- Locating the application's writable data directory.

### Preload / IPC Layer

The preload layer exposes a small, controlled API from Electron to React.

Example responsibilities:

- `products.getBySku(sku)`
- `products.list()`
- `products.create(...)`
- `sales.complete(...)`
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
        +-- Insert sale
        +-- Insert sale_items
        +-- Update stock (if enabled)
        |
        v
COMMIT
        |
        v
Generate / print receipt
        |
        v
Clear cart
```

If a database write fails before commit, the sale must roll back.

Receipt printing happens after the sale is safely stored. A printer failure must not erase or reverse a valid completed sale.

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

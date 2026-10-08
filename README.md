# POS System

A lightweight Windows point-of-sale application designed for fast, simple in-store checkout.

## Goals

- Run as a normal Windows desktop application.
- Require no development tools for the end user.
- Add products to a sale by typing a SKU/code.
- Store products, completed sales, and settings locally with SQLite.
- Preserve sale item names and prices as they were at purchase time.
- Print receipts through a Windows-compatible receipt printer.
- Continue working without an internet connection.

## Planned stack

- Electron, React, and TypeScript
- SQLite in the Electron main process
- electron-builder with an NSIS Windows installer

## MVP scope

- Product management and SKU lookup
- Keyboard-first cart and checkout
- Multiple tax calculation, split cash/card-brand tenders, and cash change
- Transaction-only line price overrides with a required reason
- Sales history with sale-time product and price snapshots
- Standalone returns with split refund payouts and per-item restocking
- Sales reports that show gross sales, returns, net totals, and Cash/Card refund totals
- Receipt choices after checkout: print, prepare an email PDF, or prepare a text summary
- Receipt business details with a live 58 mm preview, tax, and printer settings
- Offline operation and a Windows installer

## Documentation

See the `docs/` directory for [requirements](docs/requirements.md), [architecture](docs/architecture.md), [database design](docs/database-design.md), [user flows](docs/user-flows.md), [UI/UX](docs/ui-ux.md), [receipt delivery](docs/receipt-printing.md), and the [development roadmap](docs/development-roadmap.md).

## Development setup

Install [Node.js 24 LTS](https://nodejs.org/) and npm, then run:

```sh
npm ci
npm run dev
```

Useful checks and builds:

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
```

The secure desktop shell, product catalog, checkout, standalone returns, sales history and reports, receipt delivery choices, and business settings are implemented. The POS supports split tenders, cash change, transaction-only price overrides, and exact return payouts. Sale and return data remain local in SQLite; email and text drafts open in the computer's configured apps.

## Windows checks from a Mac

GitHub Actions builds the x64 NSIS installer on a Windows runner for pushes and pull requests. Download the `windows-installer` artifact from the workflow run and install it in a Windows 11 ARM virtual machine, such as VMware Fusion on Apple silicon. Windows 11 ARM can run x64 applications through emulation, which is useful for checking installation and UI behavior. It does not validate x64 printer drivers.

Use a physical Windows 10/11 x64 PC and the receipt printer for the release gate: install and launch the app, verify sale data after restart and reinstall, print a 58 mm receipt, and confirm printer failures leave completed sales available for reprinting. The printer and physical Windows checks are pending until that hardware is available.

## Status

M1–M8 are implemented locally. Windows installer builds run in CI. Interactive Windows install, mail-client attachment, messaging-app, and physical printer checks remain pending until Windows hardware is available.

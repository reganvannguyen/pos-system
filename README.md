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
- Tax and total calculation; record cash or card as the payment method
- Sales history with sale-time product and price snapshots
- Receipt generation, printing, and reprinting
- Store, tax, and printer settings
- Offline operation and a Windows installer

## Documentation

See the `docs/` directory for [requirements](docs/requirements.md), [architecture](docs/architecture.md), [database design](docs/database-design.md), [user flows](docs/user-flows.md), [UI/UX](docs/ui-ux.md), [receipt printing](docs/receipt-printing.md), and the [development roadmap](docs/development-roadmap.md).

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

The first milestone is the secure desktop shell. POS is the default screen; Products, Sales, and Settings are navigation placeholders until their roadmap milestones are implemented.

## Windows checks from a Mac

GitHub Actions builds the x64 NSIS installer on a Windows runner for pushes and pull requests. Download the `windows-installer` artifact from the workflow run and install it in a Windows 11 ARM virtual machine, such as VMware Fusion on Apple silicon. Windows 11 ARM can run x64 applications through emulation, which is useful for checking installation and UI behavior. It does not validate x64 printer drivers.

Use a physical Windows 10/11 x64 PC and the receipt printer for the release gate: install and launch the app, verify sale data after restart and reinstall, print an 80 mm receipt, and confirm printer failures leave completed sales available for reprinting. The printer and physical Windows checks are pending until that hardware is available.

## Status

M1 foundation is implemented locally. Windows installer validation and the Windows hardware release gate remain pending.

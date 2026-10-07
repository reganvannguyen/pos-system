# POS System

A lightweight Windows point-of-sale application designed for fast, simple in-store checkout.

## Goals

- Run as a normal Windows desktop application.
- Require no Docker, terminal commands, or development dependencies for the end user.
- Add products to a sale by typing a SKU/code.
- Store products, completed sales, and application settings locally with SQLite.
- Preserve historical sale item names and prices at the time of purchase.
- Print receipts through a Windows-compatible receipt printer.
- Continue working without an internet connection.

## Planned Stack

- Electron
- React
- TypeScript
- SQLite
- electron-builder for Windows packaging

## MVP

- Product management
- SKU-based product lookup
- Cart and quantity management
- Tax and total calculation
- Cash/card payment recording
- Sales history
- Receipt generation and printing
- Basic settings
- Windows installer

## Documentation

See the `docs/` directory:

- `requirements.md`
- `architecture.md`
- `database-design.md`
- `user-flows.md`
- `receipt-printing.md`
- `development-roadmap.md`

## Status

Planning and initial design.

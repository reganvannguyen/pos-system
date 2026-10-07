# Receipt Printing

## 1. Goal

Receipts are generated from completed sale data already stored in SQLite.

Printing must not be required for the sale itself to succeed.

## 2. Receipt Data

A receipt should be built from:

### Sale

- Sale ID.
- Date/time.
- Subtotal.
- Tax.
- Total.
- Payment method.

### Sale Items

- SKU if desired.
- Product name.
- Quantity.
- Unit price.
- Line total.

### Settings

- Business name.
- Optional future business details.
- Selected printer.

## 3. Printing Strategy

The MVP uses the Windows printing system rather than directly implementing a printer protocol.

```text
Saved sale
    |
    v
Build receipt HTML
    |
    v
Electron print window
    |
    v
Windows printer driver
    |
    v
Thermal receipt printer
```

This allows the POS to work with a broad range of receipt printers as long as Windows recognizes the printer and a compatible driver is installed.

## 4. Printer Selection

Electron can enumerate printers available to the computer.

The Settings screen should display those printers and save the chosen Windows printer name.

Conceptually:

```text
Receipt Printer
[ EPSON TM-T20III             v ]

[x] Print automatically after sale
```

Do not hard-code a printer model into the application.

## 5. Receipt Width

The layout should support common thermal paper widths.

Initial target:

- 80 mm receipt printers.

A later enhancement can add:

- 58 mm mode.

The printable content width is smaller than the physical paper width, so layout CSS should leave appropriate margins.

## 6. Receipt Rendering

A receipt can be rendered as a minimal HTML document.

Example structure:

```text
        STORE NAME
------------------------------
Sale #125
2026-10-07 13:15

Coke
2 x $2.50              $5.00

Chips
1 x $3.00              $3.00
------------------------------
Subtotal                $8.00
Tax                     $0.96
TOTAL                   $8.96

Payment: Cash

        Thank you!
```

Use a simple receipt-friendly font and avoid layouts that depend on a particular screen size.

## 7. Automatic Printing

When auto-print is enabled:

```text
Complete sale
    |
    v
Database commit succeeds
    |
    v
Generate receipt
    |
    v
Silent print to configured printer
```

When auto-print is disabled, show a Print Receipt action.

## 8. Printer Failure

If the printer is disconnected, out of paper, or otherwise fails:

- The completed sale remains in SQLite.
- Show a printing error to the user.
- Allow reprinting from Sales History.

Never roll back a completed sale because receipt printing failed.

## 9. Future ESC/POS Support

Many thermal printers support ESC/POS-style commands. Direct ESC/POS integration may later be useful for:

- Automatic paper cutting.
- Opening a cash drawer.
- Printer-specific formatting.
- QR/barcode output.

This is not required for the first version. Windows driver printing keeps the MVP simpler and less dependent on a particular printer model.

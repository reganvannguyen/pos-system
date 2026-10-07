# User Flows

## 1. Primary Checkout Flow

```text
Open application
      |
      v
POS screen
      |
      v
SKU field automatically focused
      |
      v
Type SKU -> Enter
      |
      +-- SKU found ----> Add/increment cart item
      |                        |
      |                        v
      |                  Focus SKU field
      |
      +-- Not found ----> Show clear error
                               |
                               v
                         Focus SKU field
```

The cashier repeats SKU entry until the cart is complete.

Then:

```text
Review cart
    |
    v
Choose Cash or Card
    |
    v
Complete Sale
    |
    v
Save transaction to SQLite
    |
    v
Print receipt if enabled
    |
    v
Clear cart
    |
    v
Focus SKU field for next customer
```

## 2. Adding the Same SKU

If the same SKU is entered again, the existing cart line quantity increases rather than creating a duplicate line.

Example:

```text
1004 Enter
1004 Enter
1004 Enter

Cart:
1004  Product Name  x3
```

## 3. Unknown SKU

When a SKU does not exist:

- Do not modify the cart.
- Show a visible "Product not found" message.
- Keep or return focus to the SKU field.
- Allow the cashier to immediately type another SKU.

## 4. Editing the Cart

The cashier can:

- Increase quantity.
- Decrease quantity.
- Remove a line.
- Clear the entire cart.

Totals recalculate immediately after any cart change.

## 5. Completing a Sale

Before saving:

- Cart must contain at least one item.
- Every item must have a positive quantity.
- Payment method must be selected.
- Totals must be calculated from stored cart values, not trusted from display text.

After a successful database commit:

- The sale receives an ID.
- A receipt can be generated from the saved sale.
- The current cart is cleared.

If printing fails, the sale remains recorded and the user can reprint it from Sales History.

## 6. Product Management Flow

```text
Products screen
      |
      +-- Add Product
      |      |
      |      +-- SKU
      |      +-- Name
      |      +-- Price
      |      +-- Optional stock
      |
      +-- Edit Product
      |
      +-- Deactivate Product
```

A duplicate SKU must be rejected.

Deactivating a product prevents new checkout lookup but must not alter historical sales.

## 7. Sales History Flow

```text
Sales screen
     |
     v
Newest sales first
     |
     v
Select sale
     |
     +-- View date/time
     +-- View payment method
     +-- View line items
     +-- View tax/total
     +-- Reprint receipt
```

## 8. Settings Flow

The Settings screen controls:

- Business/store name.
- Tax rate.
- Receipt printer.
- Auto-print preference.

Printer selection should come from printers available to Windows.

## 9. First Launch

On first launch:

1. Create/open the SQLite database.
2. Apply database migrations.
3. Insert default settings if they do not exist.
4. Open the POS screen.
5. If desired, prompt the owner to configure business name, tax rate, and printer.

The application should still open if no printer is configured.

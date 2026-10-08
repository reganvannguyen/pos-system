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
Optionally change a line price and enter the reason
    |
Choose Cash, Debit, or Credit and enter an amount
    |
    +-- Add another payment while a balance remains
    +-- Show cash change when cash exceeds the balance
    |
    v
Confirm Complete Sale when fully paid
    |
    v
Save transaction, snapshots, tenders, and stock changes atomically
    |
    v
Clear cart and staged payments
    |
    v
Show Print / Email / Text / Done receipt choices
    |
    +-- Print through the selected printer
    +-- Ask for an email address and prepare a PDF email draft
    +-- Ask for a phone number and prepare a short text draft
    +-- Done without a receipt
    |
    v
Focus SKU field for next customer
```

## 2. Standalone Return Flow

```text
Select Return mode
    |
    v
Enter a required return reason
    |
    v
Scan active or inactive catalog SKUs; adjust positive quantities
    |
    +-- Optionally select Restock on individual lines
    +-- Return values use current prices and taxes and display as negative amounts
    |
    v
Choose Cash, Debit, or Credit and record one or more exact refund payouts
    |
    +-- Partial payouts retain a remaining balance
    +-- Excess payout is rejected; no change is calculated
    +-- Card refunds are recorded and processed on the payment terminal separately
    |
    v
Confirm Complete Return
    |
    v
Atomically save the return, tax snapshots, payouts, and selected stock increases
    |
    v
Clear the return cart and open Print / Email / Text / Done receipt choices
```

Returns are standalone records with date-sequenced Return # identifiers in `YYYYMMDD-0001` format. They do not link to an invoice or verify the original purchase. The internal reason appears in history and CSV only.

## 3. Adding the Same SKU

If the same SKU is entered again, the existing cart line quantity increases rather than creating a duplicate line.

Example:

```text
1004 Enter
1004 Enter
1004 Enter

Cart:
1004  Product Name  x3
```

## 4. Unknown SKU

When a SKU does not exist:

- Do not modify the cart.
- Show a visible "Product not found" message.
- Keep or return focus to the SKU field.
- Allow the cashier to immediately type another SKU.

## 5. Editing the Cart

The cashier can:

- Increase quantity.
- Decrease quantity.
- Remove a line.
- Clear the entire cart.

Totals recalculate immediately after any cart change.

## 6. Completing a Sale

Before saving:

- Cart must contain at least one item.
- Every item must have a positive quantity.
- All payment entries must be valid and together cover the total; cash alone may exceed the remaining balance and produce change.
- Prices and totals must be resolved and calculated in the main process, not trusted from renderer display text.

After a successful database commit:

- The sale receives an ID.
- The POS clears the cart and opens receipt choices.

If printing or draft preparation fails, the sale remains recorded. Staff can retry from the receipt
dialog or reopen receipt choices from Sales History. Recipient email addresses and phone numbers are
not stored by the POS.

## 7. Product Management Flow

The Products screen searches product names and SKUs and can show active or inactive products. SKUs are saved uppercase after trimming surrounding whitespace. Prices are entered in CAD; blank stock means untracked, while zero is a tracked quantity.

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

A duplicate SKU must be rejected even when the existing product is inactive. Changing a product's SKU releases the previous value. Deactivation requires confirmation, prevents new checkout lookup, and preserves the product and its current SKU. The inactive-products view lets the user edit or reactivate it without changing historical sales.

## 8. Sales History Flow

```text
Sales screen
     |
     v
Choose day, month, year, or custom range
     |
     +-- Review all matching sales and totals
     +-- Export selected period as CSV
     |
     v
Newest matching sales first
     |
     v
Select sale
     |
     +-- View date/time
     +-- View payment method
     +-- View each tender amount and cash change
     +-- View line items
     +-- View any transaction price override and reason
     +-- View tax/total
     +-- Open receipt choices to print, email, or text again
```

## 9. Settings Flow

The Settings screen controls:

- Business/store name.
- Optional business contact email.
- Tax rate.
- Receipt printer.

Printer selection should come from printers available to Windows.

## 10. First Launch

On first launch:

1. Create/open the SQLite database.
2. Apply database migrations.
3. Insert default settings if they do not exist.
4. Open the POS screen.
5. If desired, prompt the owner to configure business name, tax rates, and printer.

The application should still open if no printer is configured.

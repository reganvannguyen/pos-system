# UI / UX Design

## 1. Purpose

The POS interface should be simple, fast, and easy to understand with minimal training.

The UI should feel like a practical desktop tool rather than a complex consumer application.

The primary design priorities are:

1. Speed.
2. Clarity.
3. Low error risk.
4. Minimal clicking.
5. Keyboard-first checkout.

A cashier should be able to complete a normal sale without touching the mouse until payment selection.

## 2. Design Principles

### Keep the Main Workflow Obvious

The primary checkout flow should always be clear:

```text
Type SKU
   |
   v
Press Enter
   |
   v
Product added to cart
   |
   v
Repeat as needed
   |
   v
Choose payment method
   |
   v
Complete sale
```

The application should avoid unnecessary screens, popups, and navigation during checkout.

### Keyboard First

The POS screen should be optimized for keyboard use.

The SKU field should:

- Automatically receive focus when the POS screen opens.
- Accept a SKU and add the matching product when Enter is pressed.
- Return focus to the SKU field after a product is added.
- Keep focus available after an invalid SKU so the cashier can immediately try again.

### Minimize Decisions

The cashier should only need to make decisions that are required to complete a sale.

Avoid:

- Unnecessary configuration during checkout.
- Excessive confirmation dialogs.
- Hidden actions.
- Multi-step checkout screens.

### Make Errors Easy to Recover From

Errors should:

- Be clearly visible.
- Explain what went wrong.
- Avoid clearing valid work.
- Allow the cashier to continue immediately.

For example, an unknown SKU should not clear the cart.

### Prefer Familiar Desktop Patterns

Use familiar controls such as:

- Tables.
- Text inputs.
- Buttons.
- Simple confirmation dialogs.
- Standard navigation.
- Clear labels.

The app should feel natural on Windows.

## 3. Navigation

The application has four main sections:

```text
POS        Products        Sales        Settings
```

The POS screen is the default screen when the application opens.

Navigation should remain visible so the user can switch sections quickly.

Suggested application shell:

```text
+------------------------------------------------------------------+
| Simple POS                    POS  Products  Sales  Settings      |
+------------------------------------------------------------------+
|                                                                  |
|                         Current Screen                           |
|                                                                  |
+------------------------------------------------------------------+
```

The navigation should be visually clear without taking up unnecessary space.

## 4. POS Screen

The POS screen is the most important screen in the application.

It should prioritize:

- SKU entry.
- Cart visibility.
- Total visibility.
- Fast payment selection.

Suggested layout:

```text
+---------------------------------------------------------------------+
| Simple POS                         POS  Products  Sales  Settings    |
+---------------------------------------------------------------------+
|                                                                     |
|  Enter SKU                                                          |
|  +----------------------------------------------+                   |
|  | 1042                                         |                   |
|  +----------------------------------------------+                   |
|                                                                     |
|  CART                                                               |
|  +---------------------------------------------------------------+  |
|  | SKU     Product              Qty      Price       Total       |  |
|  | 1042    Coke                  2        $2.50       $5.00       |  |
|  | 2051    Chips                 1        $3.25       $3.25       |  |
|  |                                                               |  |
|  |                                              Subtotal  $8.25  |  |
|  |                                              Tax       $0.99  |  |
|  |                                              TOTAL     $9.24  |  |
|  +---------------------------------------------------------------+  |
|                                                                     |
|                                [ CASH ]       [ CARD ]              |
|                                                                     |
+---------------------------------------------------------------------+
```

### SKU Entry

The SKU input is the primary control on the POS screen.

Expected behavior:

```text
1042 -> Enter
2051 -> Enter
1042 -> Enter
```

Result:

```text
1042  Coke   x2
2051  Chips  x1
```

Entering the same SKU again should increase the existing cart item's quantity instead of adding a duplicate row.

An Add button may be included for discoverability, but pressing Enter should remain the primary interaction.

### Unknown SKU

If a SKU does not exist, show a clear message directly near the input.

Example:

```text
Product not found: 9999
```

The system should:

- Leave the existing cart unchanged.
- Keep or restore focus to the SKU field.
- Allow another SKU to be entered immediately.

### Cart Controls

Each cart line should provide simple quantity controls.

Example:

```text
Coke        [-] 2 [+]      $5.00      Remove
```

The cashier should be able to:

- Increase quantity.
- Decrease quantity.
- Remove an item.
- Clear the entire cart.

Totals should update immediately after any change.

### Totals

Subtotal, tax, and total should remain visually grouped and easy to scan.

The final total should have the strongest visual emphasis.

Example:

```text
Subtotal      $8.25
Tax           $0.99

TOTAL         $9.24
```

## 5. Checkout Interaction

The MVP should not use a separate checkout page.

Payment selection should remain on the POS screen.

Suggested controls:

```text
TOTAL
$9.24

[ CASH ]     [ CARD ]
```

Selecting Cash or Card should open a small confirmation dialog.

Example:

```text
Complete Cash Sale?

Total: $9.24

[ Cancel ]     [ Complete Sale ]
```

This confirmation helps prevent accidental sales during the initial version.

A future release may make confirmation optional if it becomes unnecessary during real use.

### Successful Sale

After a successful sale:

```text
✓ Sale completed

[ Print Receipt ]    [ New Sale ]
```

If automatic receipt printing is enabled:

1. The sale is saved.
2. The receipt is sent to the configured printer.
3. The cart is cleared.
4. The SKU field receives focus for the next customer.

## 6. Products Screen

The Products screen manages the local product catalog.

Suggested layout:

```text
+------------------------------------------------------------------+
| Products                                         [+ Add Product] |
+------------------------------------------------------------------+
| Search products...                                                |
|                                                                   |
| SKU       Name                    Price       Stock       Action  |
| ---------------------------------------------------------------- |
| 1042      Coke                    $2.50         40        Edit    |
| 2051      Chips                   $3.25         25        Edit    |
| 3014      Chocolate Bar           $1.75         12        Edit    |
|                                                                   |
+------------------------------------------------------------------+
```

### Product Form

Adding and editing products should use the same basic form.

Example:

```text
Add Product

SKU
[ 1042                 ]

Product Name
[ Coke 500ml           ]

Price
[ $2.50                ]

Stock
[ 40                   ]

[ Cancel ]                [ Save Product ]
```

Required fields should be clearly marked.

Validation should happen close to the relevant input.

Examples:

- Duplicate SKU.
- Missing product name.
- Invalid price.
- Invalid stock value.

### Product Removal

Products should be deactivated rather than permanently deleted.

This prevents historical sale records from becoming confusing or losing their product references.

A destructive action should be visually distinct and require confirmation.

## 7. Sales Screen

The Sales screen should make past transactions easy to review.

Suggested layout:

```text
Sales

Search / Filter

----------------------------------------------------------------
Sale #     Date                   Payment       Items       Total
----------------------------------------------------------------
#105       Oct 7, 1:42 PM         Cash             3       $18.24
#104       Oct 7, 1:31 PM         Card             5       $27.93
#103       Oct 7, 1:22 PM         Cash             1        $4.99
```

Newest sales should appear first.

### Sale Detail

Selecting a sale should show its full contents.

Example:

```text
Sale #105

October 7, 2026 - 1:42 PM

Coke             2 x $2.50        $5.00
Chips            1 x $3.25        $3.25
Chocolate        2 x $1.75        $3.50

Subtotal                         $11.75
Tax                               $1.41
TOTAL                            $13.16

Payment: Cash

[ Reprint Receipt ]
```

A sale detail screen should use the historical values stored in `sale_items`, not the current product name or price.

## 8. Settings Screen

The Settings screen should contain only configuration relevant to normal POS operation.

Suggested layout:

```text
Settings

BUSINESS

Business Name
[ My Store                    ]

Tax Rate
[ 12.00 ] %


RECEIPT

Printer
[ EPSON Receipt Printer       v ]

[x] Print receipt automatically


                               [ Save Settings ]
```

Settings should be grouped into clear sections instead of displayed as one long form.

Initial sections:

- Business.
- Receipt.

Additional groups can be added later only when needed.

## 9. Visual Style

The initial visual design should remain simple and functional.

### General Style

Use:

- Light background.
- Dark readable text.
- Subtle borders.
- Clear spacing.
- Large enough click targets.
- One primary accent color.
- Minimal animation.
- Strong contrast for important totals and actions.

Avoid:

- Heavy gradients.
- Decorative animation.
- Excessive shadows.
- Large illustrations.
- Dense dashboards.
- Too many colors.

The intended style is closer to:

```text
Square / Shopify POS simplicity
+
Windows desktop practicality
```

rather than a consumer website.

## 10. Button Hierarchy

Buttons should visually communicate importance.

Examples:

```text
[ Complete Sale ]     Primary action

[ Edit ]              Standard action

[ Cancel ]            Secondary action

[ Deactivate ]        Destructive action
```

Only one action in a group should normally receive the strongest primary styling.

## 11. Feedback and Status

### Success

Successful actions should be easy to notice without interrupting workflow.

Examples:

- Product saved.
- Sale completed.
- Settings saved.
- Receipt sent to printer.

### Errors

Errors should:

- Appear near the relevant control when possible.
- Use plain language.
- Tell the user what they can do next.

Examples:

```text
Product not found: 9999
```

```text
SKU 1042 already exists.
```

```text
Receipt could not be printed. The sale was saved successfully.
```

### Loading States

Most local operations should complete almost instantly.

If an action takes noticeable time, show a small loading or disabled state so the user knows the application is working.

## 12. Keyboard Behavior

Keyboard interaction is a core part of the POS UX.

Initial keyboard behavior:

- Typing goes into the focused SKU field.
- Enter adds the SKU.
- SKU field regains focus after adding a product.
- Escape may close non-critical dialogs.
- Tab follows a logical order through controls.

Future shortcuts may include:

- Focus SKU field.
- Remove selected item.
- Increase/decrease quantity.
- Choose Cash.
- Choose Card.

Shortcuts should only be added when they are easy to remember and do not create accidental sales.

## 13. Responsive Window Behavior

The app is primarily designed for a Windows desktop or POS terminal.

The UI should:

- Work well at common desktop resolutions.
- Avoid horizontal scrolling during normal checkout.
- Keep totals and payment controls visible where practical.
- Allow the application window to be maximized.
- Avoid layouts that depend on a specific monitor size.

Mobile layouts are not required.

## 14. UX Rules

The following rules should guide future UI decisions:

1. The POS screen is always the fastest path to completing a sale.
2. Normal checkout should require minimal mouse interaction.
3. Important totals and payment actions must be immediately visible.
4. Errors must never silently clear the cart.
5. Printer errors must never remove a completed sale.
6. Historical sales must always display historical product data.
7. Configuration belongs in Settings, not in checkout.
8. Avoid adding screens unless they clearly simplify the workflow.
9. Prefer clear text labels over unfamiliar icons.
10. Optimize for someone who needs to understand the application quickly.

## 15. Future UI Enhancements

Possible improvements after the MVP:

- Dark mode.
- Configurable keyboard shortcuts.
- Larger touch-target mode for touchscreen terminals.
- 58 mm / 80 mm receipt layout selection.
- Product categories.
- Quick product buttons for common items.
- Cash amount tendered and change calculation.
- Daily sales summary.
- Improved filtering and search.
- Employee login/permissions if multi-user support is introduced.

These features should only be added after the core checkout workflow is stable and easy to use.

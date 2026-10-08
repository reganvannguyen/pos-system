ALTER TABLE sale_items
  ADD COLUMN original_unit_price_cents INTEGER NOT NULL DEFAULT 0
  CHECK (original_unit_price_cents >= 0);

ALTER TABLE sale_items
  ADD COLUMN price_override_reason TEXT;

UPDATE sale_items
SET original_unit_price_cents = unit_price_cents;

CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'debit', 'mastercard', 'visa', 'card')),
  amount_tendered_cents INTEGER CHECK (amount_tendered_cents IS NULL OR amount_tendered_cents > 0),
  amount_applied_cents INTEGER NOT NULL CHECK (amount_applied_cents >= 0),
  change_cents INTEGER NOT NULL CHECK (change_cents >= 0),
  CHECK (amount_tendered_cents IS NULL OR amount_tendered_cents = amount_applied_cents + change_cents),
  CHECK (payment_type = 'cash' OR change_cents = 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE INDEX idx_sale_payments_sale_id ON sale_payments(sale_id, id);

INSERT INTO sale_payments (
  sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents
)
SELECT id, payment_method,
       CASE WHEN payment_method = 'cash' OR total_cents = 0 THEN NULL ELSE total_cents END,
       total_cents, 0
FROM sales;

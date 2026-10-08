CREATE TABLE sale_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'debit', 'credit', 'mastercard', 'visa', 'card')),
  amount_tendered_cents INTEGER CHECK (amount_tendered_cents IS NULL OR amount_tendered_cents > 0),
  amount_applied_cents INTEGER NOT NULL CHECK (amount_applied_cents >= 0),
  change_cents INTEGER NOT NULL CHECK (change_cents >= 0),
  CHECK (amount_tendered_cents IS NULL OR amount_tendered_cents = amount_applied_cents + change_cents),
  CHECK (payment_type = 'cash' OR change_cents = 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

INSERT INTO sale_payments_new (
  id, sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents
)
SELECT id, sale_id, payment_type, amount_tendered_cents, amount_applied_cents, change_cents
FROM sale_payments;

DROP TABLE sale_payments;
ALTER TABLE sale_payments_new RENAME TO sale_payments;

CREATE INDEX idx_sale_payments_sale_id ON sale_payments(sale_id, id);

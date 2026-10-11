CREATE TABLE charge_payments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'debit', 'credit', 'etransfer', 'check')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (charge_id) REFERENCES sale_charges(id) ON DELETE CASCADE
);

INSERT INTO charge_payments_new (id, charge_id, payment_type, amount_cents, created_at)
SELECT id, charge_id, payment_type, amount_cents, created_at
FROM charge_payments;

DROP TABLE charge_payments;
ALTER TABLE charge_payments_new RENAME TO charge_payments;

CREATE INDEX idx_charge_payments_charge_id ON charge_payments(charge_id, id);
CREATE INDEX idx_charge_payments_created_at ON charge_payments(created_at);

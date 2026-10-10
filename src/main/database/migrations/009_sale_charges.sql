CREATE TABLE sale_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL UNIQUE,
  customer_name TEXT NOT NULL CHECK (length(trim(customer_name)) > 0),
  company_name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  phone_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE TABLE charge_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id INTEGER NOT NULL,
  payment_type TEXT NOT NULL CHECK (payment_type IN ('cash', 'debit', 'credit')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (charge_id) REFERENCES sale_charges(id) ON DELETE CASCADE
);

CREATE INDEX idx_charge_payments_charge_id ON charge_payments(charge_id, id);
CREATE INDEX idx_charge_payments_created_at ON charge_payments(created_at);

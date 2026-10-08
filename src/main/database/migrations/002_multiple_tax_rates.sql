CREATE TABLE tax_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  sort_order INTEGER NOT NULL
);

INSERT INTO tax_rates (name, rate_basis_points, sort_order)
SELECT 'Tax', tax_rate_basis_points, 0
FROM settings
WHERE id = 1 AND tax_rate_basis_points > 0;

CREATE TABLE sale_taxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL,
  tax_name TEXT NOT NULL,
  rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
  tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE INDEX idx_sale_taxes_sale_id ON sale_taxes(sale_id, id);

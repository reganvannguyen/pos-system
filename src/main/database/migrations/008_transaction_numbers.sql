ALTER TABLE sales
  ADD COLUMN transaction_number TEXT;

CREATE UNIQUE INDEX idx_sales_transaction_number ON sales(transaction_number);

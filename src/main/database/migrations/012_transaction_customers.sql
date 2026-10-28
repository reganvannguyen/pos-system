ALTER TABLE sales
ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL;

CREATE INDEX idx_sales_customer_id ON sales(customer_id);

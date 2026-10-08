ALTER TABLE sales
  ADD COLUMN transaction_type TEXT NOT NULL DEFAULT 'sale'
  CHECK (transaction_type IN ('sale', 'return'));

ALTER TABLE sales
  ADD COLUMN return_reason TEXT;

ALTER TABLE sale_items
  ADD COLUMN restock_requested INTEGER NOT NULL DEFAULT 0
  CHECK (restock_requested IN (0, 1));

ALTER TABLE sale_items
  ADD COLUMN restocked_quantity INTEGER NOT NULL DEFAULT 0
  CHECK (restocked_quantity >= 0 AND restocked_quantity <= quantity);

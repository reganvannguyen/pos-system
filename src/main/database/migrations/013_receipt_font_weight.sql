ALTER TABLE settings
ADD COLUMN receipt_font_weight INTEGER NOT NULL DEFAULT 400
CHECK (receipt_font_weight IN (300, 400, 500, 600, 700));

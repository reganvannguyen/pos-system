ALTER TABLE settings ADD COLUMN business_address TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_city TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_province TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_phone TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_gst_number TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN business_website TEXT NOT NULL DEFAULT '';

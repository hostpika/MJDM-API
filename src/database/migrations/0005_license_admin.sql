-- 0005_license_admin.sql: align the licenses table with what the service writes, and record how a
-- license was issued (by an admin by hand, or from a payment).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'licenses' AND column_name = 'key_hash') THEN
    ALTER TABLE licenses RENAME COLUMN key_hash TO key_hmac;
  END IF;
END $$;

-- Plans are defined in code (ids like "plan-lifetime-pro"), not as UUID rows.
ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_plan_id_fkey;
ALTER TABLE licenses ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text;

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source    VARCHAR(30) NOT NULL DEFAULT 'manual';
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS note      TEXT;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS issued_by VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_licenses_user ON licenses(user_id);

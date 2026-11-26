-- 0007_keys_email_trial.sql
-- 1. licenses.key_enc: the license key, encrypted (AES-256-GCM, key derived from SERVER_PEPPER), so
--    an admin can show it again or email it later. Licenses made before this have no copy (NULL).
-- 2. app_settings: small admin-editable settings (trial length, SMTP account).
-- 3. trials: when each computer started its free trial, so reinstalling does not restart it.
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS key_enc TEXT;

CREATE TABLE IF NOT EXISTS app_settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS trials (
    device_hash  VARCHAR(64) PRIMARY KEY,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    platform     VARCHAR(30),
    app_version  VARCHAR(30)
);

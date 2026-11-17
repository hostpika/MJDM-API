-- 0002_v2_delta.sql
-- MJDM Cloud Database v2 Delta (Master Plan §13.4)

-- license key: plain hash নয়, server-pepper সহ HMAC
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'licenses' AND column_name = 'key_hash'
  ) THEN
    ALTER TABLE licenses RENAME COLUMN key_hash TO key_hmac;
  END IF;
END $$;

ALTER TABLE licenses DROP CONSTRAINT IF EXISTS licenses_status_chk;
ALTER TABLE licenses
    ADD CONSTRAINT licenses_status_chk CHECK (status IN ('active','revoked','expired','refunded'));

ALTER TABLE license_activations DROP CONSTRAINT IF EXISTS activations_status_chk;
ALTER TABLE license_activations
    ADD CONSTRAINT activations_status_chk CHECK (status IN ('active','revoked'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payments' AND column_name = 'idempotency_key'
  ) THEN
    ALTER TABLE payments ADD COLUMN idempotency_key VARCHAR(255) UNIQUE;
  END IF;
END $$;

-- FK-তে index
CREATE INDEX IF NOT EXISTS idx_licenses_user      ON licenses(user_id);
CREATE INDEX IF NOT EXISTS idx_activations_device ON license_activations(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_user       ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_user      ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_logs(actor_type, actor_id, created_at DESC);

-- token revocation / jti
CREATE TABLE IF NOT EXISTS license_tokens (
    jti         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id  UUID NOT NULL REFERENCES licenses(id),
    device_id   UUID NOT NULL REFERENCES devices(id),
    kid         VARCHAR(40) NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ
);

-- E2EE sync (P11) — server কখনো plaintext দেখে না
CREATE SEQUENCE IF NOT EXISTS sync_seq;

CREATE TABLE IF NOT EXISTS sync_accounts (
    user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    kdf_params           JSONB NOT NULL,            -- {"alg":"argon2id","m":65536,"t":3,"p":4,"salt":"..."}
    wrapped_mk           BYTEA NOT NULL,
    wrapped_mk_recovery  BYTEA NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_records (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection      VARCHAR(40) NOT NULL,
    record_id       UUID NOT NULL,
    server_seq      BIGINT NOT NULL DEFAULT nextval('sync_seq'),
    hlc             BIGINT NOT NULL,
    device_tag      VARCHAR(40) NOT NULL,
    deleted         BOOLEAN NOT NULL DEFAULT FALSE,
    schema_version  INTEGER NOT NULL,
    blob            BYTEA NOT NULL CHECK (octet_length(blob) <= 65536),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, collection, record_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_seq ON sync_records(user_id, server_seq);

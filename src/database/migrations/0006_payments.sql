-- 0006_payments.sql: checkout orders, gateway settings (credentials encrypted), manual payment
-- reports that an admin approves, bKash personal numbers, and received bKash SMS messages.

CREATE TABLE IF NOT EXISTS payment_gateways (
    slug        VARCHAR(40) PRIMARY KEY,
    enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
    mode        VARCHAR(10) NOT NULL DEFAULT 'live',
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    config_enc  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS orders (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token             VARCHAR(64) NOT NULL UNIQUE,
    email             VARCHAR(255) NOT NULL,
    customer_name     VARCHAR(150),
    plan_key          VARCHAR(20)  NOT NULL,
    plan_id           VARCHAR(100) NOT NULL,
    base_usd_minor    INTEGER      NOT NULL,
    base_bdt          INTEGER      NOT NULL,
    status            VARCHAR(20)  NOT NULL DEFAULT 'pending',
    gateway_slug      VARCHAR(40),
    gateway_ref       VARCHAR(255),
    currency          CHAR(3),
    amount_due_minor  BIGINT,
    chain_coin        VARCHAR(10),
    chain_network     VARCHAR(20),
    chain_address     TEXT,
    license_id        UUID,
    key_enc           TEXT,
    meta              JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    paid_at           TIMESTAMPTZ,
    expires_at        TIMESTAMPTZ  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_gateway_ref ON orders(gateway_slug, gateway_ref);

CREATE TABLE IF NOT EXISTS payment_submissions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID         NOT NULL REFERENCES orders(id),
    gateway_slug VARCHAR(40)  NOT NULL,
    trx_id       VARCHAR(80)  NOT NULL,
    sender       VARCHAR(80),
    status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
    verified_by  VARCHAR(40),
    admin_note   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    decided_at   TIMESTAMPTZ,
    decided_by   VARCHAR(255)
);
-- A transaction id can pay for one order only.
CREATE UNIQUE INDEX IF NOT EXISTS uq_submission_trx
    ON payment_submissions (gateway_slug, upper(trx_id)) WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS bkash_numbers (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number     VARCHAR(20)  NOT NULL UNIQUE,
    label      VARCHAR(100),
    enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bkash_sms_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trx_id        VARCHAR(80),
    amount_taka   NUMERIC(12,2),
    sender        VARCHAR(80),
    matched_order UUID,
    note          VARCHAR(200),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 0001_initial_schema.sql
-- MJDM Cloud Database Initial Schema (Master Plan §13.3)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email             VARCHAR(255) NOT NULL UNIQUE,
    password_hash     TEXT NOT NULL,
    display_name      VARCHAR(150),
    status            VARCHAR(30) NOT NULL DEFAULT 'active',
    email_verified_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug   VARCHAR(100) NOT NULL UNIQUE,
    name   VARCHAR(150) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'active'
);

-- Pricing Plans
CREATE TABLE IF NOT EXISTS plans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID NOT NULL REFERENCES products(id),
    name          VARCHAR(100) NOT NULL,
    plan_type     VARCHAR(30) NOT NULL, -- 'lifetime', 'annual', 'monthly'
    duration_days INTEGER,
    max_devices   INTEGER NOT NULL DEFAULT 1,
    price_minor   BIGINT NOT NULL,
    currency      CHAR(3) NOT NULL DEFAULT 'USD',
    status        VARCHAR(30) NOT NULL DEFAULT 'active'
);

-- Licenses
CREATE TABLE IF NOT EXISTS licenses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    plan_id    UUID NOT NULL REFERENCES plans(id),
    key_hash   TEXT NOT NULL UNIQUE,
    status     VARCHAR(30) NOT NULL DEFAULT 'active',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Devices
CREATE TABLE IF NOT EXISTS devices (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id),
    device_uuid  UUID NOT NULL,
    platform     VARCHAR(30) NOT NULL,
    os_version   VARCHAR(50),
    app_version  VARCHAR(30),
    device_name  VARCHAR(150),
    last_seen_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, device_uuid)
);

-- License ↔ Device activations
CREATE TABLE IF NOT EXISTS license_activations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    license_id   UUID NOT NULL REFERENCES licenses(id),
    device_id    UUID NOT NULL REFERENCES devices(id),
    status       VARCHAR(30) NOT NULL DEFAULT 'active',
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,
    UNIQUE(license_id, device_id)
);

-- Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    plan_id    UUID NOT NULL REFERENCES plans(id),
    status     VARCHAR(30) NOT NULL,
    starts_at  TIMESTAMPTZ NOT NULL,
    ends_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES users(id),
    subscription_id    UUID REFERENCES subscriptions(id),
    provider           VARCHAR(50) NOT NULL,
    provider_reference VARCHAR(255),
    amount_minor       BIGINT NOT NULL,
    currency           CHAR(3) NOT NULL,
    status             VARCHAR(30) NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- App releases
CREATE TABLE IF NOT EXISTS app_releases (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   UUID NOT NULL REFERENCES products(id),
    version      VARCHAR(30) NOT NULL,
    platform     VARCHAR(30) NOT NULL,
    architecture VARCHAR(30) NOT NULL,
    channel      VARCHAR(30) NOT NULL DEFAULT 'stable',
    is_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    release_notes TEXT,
    published_at TIMESTAMPTZ,
    UNIQUE(product_id, version, platform, architecture)
);

-- Update artifacts (installer files)
CREATE TABLE IF NOT EXISTS update_artifacts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID NOT NULL REFERENCES app_releases(id),
    artifact_url TEXT NOT NULL,
    file_size   BIGINT NOT NULL,
    sha256      VARCHAR(64) NOT NULL,
    signature   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payment webhook events (idempotency)
CREATE TABLE IF NOT EXISTS payment_webhook_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider        VARCHAR(50) NOT NULL,
    event_id        VARCHAR(255) NOT NULL UNIQUE,
    event_type      VARCHAR(100) NOT NULL,
    payload         JSONB NOT NULL,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refresh tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    device_id  UUID REFERENCES devices(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id),
    subject    VARCHAR(255) NOT NULL,
    status     VARCHAR(30) NOT NULL DEFAULT 'open',
    priority   VARCHAR(30) NOT NULL DEFAULT 'normal',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_type VARCHAR(30) NOT NULL,
    actor_id   UUID,
    action     VARCHAR(100) NOT NULL,
    resource   VARCHAR(100),
    resource_id UUID,
    metadata   JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin users
CREATE TABLE IF NOT EXISTS admin_users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          VARCHAR(30) NOT NULL DEFAULT 'admin',
    mfa_enabled   BOOLEAN DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

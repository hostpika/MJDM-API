-- 0003_site_content.sql: admin-editable website content (single JSON document keyed by name)
CREATE TABLE IF NOT EXISTS site_content (
    key        VARCHAR(50) PRIMARY KEY,
    value      JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(255)
);

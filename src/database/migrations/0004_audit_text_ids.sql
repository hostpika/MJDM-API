-- 0004_audit_text_ids.sql: admin actions are attributed to an email address and name resources such as
-- "site", neither of which is a UUID. The columns had no foreign keys, so widening them is safe and
-- keeps every existing value (UUIDs convert to their text form).
ALTER TABLE audit_logs ALTER COLUMN actor_id TYPE VARCHAR(255) USING actor_id::text;
ALTER TABLE audit_logs ALTER COLUMN resource_id TYPE VARCHAR(255) USING resource_id::text;

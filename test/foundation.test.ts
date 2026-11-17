import { describe, expect, it } from "vitest";
import { validateEnv } from "../src/config/env.schema";
import { loadMigrations } from "../src/database/migrate";
import { createNestApp } from "../src/main";

describe("P10-T01: Backend Foundation", () => {
  describe("Configuration & Environment Validation", () => {
    it("should accept valid defaults without errors", () => {
      const cfg = validateEnv({});
      expect(cfg.PORT).toBe(3001);
      expect(cfg.NODE_ENV).toBe("development");
      expect(cfg.JWT_SECRET.length).toBeGreaterThanOrEqual(32);
      expect(cfg.SERVER_PEPPER.length).toBeGreaterThanOrEqual(32);
    });

    it("should reject JWT_SECRET shorter than 32 characters", () => {
      expect(() => {
        validateEnv({ JWT_SECRET: "short" });
      }).toThrow(/Invalid environment configuration/);
    });

    it("should reject SERVER_PEPPER shorter than 32 characters", () => {
      expect(() => {
        validateEnv({ SERVER_PEPPER: "short_pepper" });
      }).toThrow(/Invalid environment configuration/);
    });
  });

  describe("Database Migrations Validation (§13.3 & §13.4)", () => {
    it("should discover both initial schema and v2 delta migrations", () => {
      const migrations = loadMigrations();
      expect(migrations.length).toBeGreaterThanOrEqual(2);

      const names = migrations.map((m) => m.name);
      expect(names).toContain("0001_initial_schema.sql");
      expect(names).toContain("0002_v2_delta.sql");
    });

    it("0001_initial_schema.sql should contain all core tables from §13.3", () => {
      const migrations = loadMigrations();
      const m1 = migrations.find((m) => m.name === "0001_initial_schema.sql");
      expect(m1).toBeDefined();

      const sql = m1?.sql ?? "";
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS users");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS products");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS plans");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS licenses");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS devices");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS license_activations");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS subscriptions");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS payments");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS app_releases");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS update_artifacts");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS payment_webhook_events");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS refresh_tokens");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS audit_logs");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS admin_users");
    });

    it("0002_v2_delta.sql should contain E2EE sync tables and indexes from §13.4", () => {
      const migrations = loadMigrations();
      const m2 = migrations.find((m) => m.name === "0002_v2_delta.sql");
      expect(m2).toBeDefined();

      const sql = m2?.sql ?? "";
      expect(sql).toContain("sync_accounts");
      expect(sql).toContain("sync_records");
      expect(sql).toContain("license_tokens");
      expect(sql).toContain("idx_licenses_user");
      expect(sql).toContain("idx_sync_seq");
    });
  });

  describe("NestJS App, Health & OpenAPI generation", () => {
    it("should initialize Nest app, produce OpenAPI document, and handle health/live", async () => {
      const { app, document } = await createNestApp();
      await app.init();

      expect(document.info.title).toBe("MJDM Cloud Platform API");
      expect(document.info.version).toBe("1.0.0");
      expect(document.paths["/health/live"]).toBeDefined();
      expect(document.paths["/health/ready"]).toBeDefined();

      await app.close();
    });
  });
});

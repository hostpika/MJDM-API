import { describe, expect, it } from "vitest";
import { AdminLicensesController } from "../src/admin/admin-licenses.controller";
import type { AdminRequest } from "../src/admin/admin.guard";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicensesService } from "../src/licenses/licenses.service";

describe("Admin: issue and revoke licenses by hand", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const es256 = new Es256Service(config);
  es256.onModuleInit();
  const licenses = new LicensesService(db, config, es256);
  const audits: Array<{ action: string }> = [];
  const adminService = {
    recordAudit: async (_actor: string, action: string) => {
      audits.push({ action });
      return {};
    },
  };
  const controller = new AdminLicensesController(licenses, adminService as never, { sendLicense: async () => undefined } as never);
  const req = { admin: { sub: "boss@mjdm.us" }, ip: "127.0.0.1" } as unknown as AdminRequest;

  it("lists the plans a license can be issued for", () => {
    const plans = controller.plans();
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.some((p) => p.id === "plan-lifetime-pro")).toBe(true);
  });

  it("issues a key once, lists the license without the key, and the key activates a device", async () => {
    const made = await controller.issue(
      { email: "Buyer@Example.com", name: "Test Buyer", planId: "plan-lifetime-pro", note: "bKash TrxID 8AB12" },
      req
    );
    expect(made.key).toMatch(/^MJDM-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(made.email).toBe("buyer@example.com");

    const rows = await controller.list();
    const row = rows.find((r) => r.id === made.licenseId);
    expect(row).toBeDefined();
    expect(row?.email).toBe("buyer@example.com");
    expect(row?.note).toBe("bKash TrxID 8AB12");
    expect(row?.source).toBe("manual");
    expect(row?.issuedBy).toBe("boss@mjdm.us");
    expect(row?.activeDevices).toBe(0);
    expect(JSON.stringify(rows)).not.toContain(made.key);

    const activation = await licenses.activate({
      licenseKey: made.key,
      deviceUuid: "11111111-2222-4333-8444-555555555555",
      platform: "windows",
    });
    expect(activation.licenseId).toBe(made.licenseId);
    expect((await controller.list()).find((r) => r.id === made.licenseId)?.activeDevices).toBe(1);
    expect(audits.some((a) => a.action === "license.issue")).toBe(true);
  });

  it("a second license for the same email reuses the customer", async () => {
    const a = await controller.issue({ email: "same@example.com", planId: "plan-annual-personal" }, req);
    const b = await controller.issue({ email: "SAME@example.com", planId: "plan-annual-family" }, req);
    const rows = await controller.list();
    const mine = rows.filter((r) => r.email === "same@example.com");
    expect(mine.map((r) => r.id).sort()).toEqual([a.licenseId, b.licenseId].sort());
    expect(mine.find((r) => r.id === a.licenseId)?.expiresAt).not.toBeNull(); // annual plan expires
  });

  it("revoking stops the key from activating anything new", async () => {
    const made = await controller.issue({ email: "refund@example.com", planId: "plan-lifetime-pro" }, req);
    await controller.revoke(made.licenseId, req);
    expect((await controller.list()).find((r) => r.id === made.licenseId)?.status).toBe("revoked");
    await expect(
      licenses.activate({
        licenseKey: made.key,
        deviceUuid: "99999999-2222-4333-8444-555555555555",
        platform: "windows",
      })
    ).rejects.toThrow();
    expect(audits.some((a) => a.action === "license.revoke")).toBe(true);
  });

  it("an unknown plan is refused", async () => {
    await expect(controller.issue({ email: "x@example.com", planId: "plan-does-not-exist" }, req)).rejects.toThrow();
  });
});

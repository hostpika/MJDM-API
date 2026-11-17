import { describe, expect, it } from "vitest";
import { AdminService } from "../src/admin/admin.service";
import { AdminController } from "../src/admin/admin.controller";

describe("P10-T07: Admin Subsystem (cloud-api)", () => {
  it("should provide overview stats metrics", async () => {
    const adminService = new AdminService();
    const stats = await adminService.getStats();

    expect(stats.totalUsers).toBeGreaterThan(0);
    expect(stats.activeLicenses).toBeGreaterThan(0);
    expect(stats.totalRevenueMinor).toBeGreaterThan(0);
    expect(stats.totalRevenueFormatted).toContain("$");
  });

  it("should record and retrieve immutable audit logs", async () => {
    const adminService = new AdminService();
    const controller = new AdminController(adminService);

    const record = await controller.recordAudit({
      actorId: "admin-user-001",
      action: "license.revoke",
      resource: "license",
      resourceId: "lic-test-999",
      metadata: { reason: "Terms violation" },
    });

    expect(record.id).toBeDefined();
    expect(record.actorId).toBe("admin-user-001");
    expect(record.action).toBe("license.revoke");

    const logs = await controller.getAuditLogs(10);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe("license.revoke");
  });
});

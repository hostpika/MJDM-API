import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BadRequestException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminLicensesController } from "../src/admin/admin-licenses.controller";
import { AdminSettingsController } from "../src/admin/admin-settings.controller";
import type { AdminRequest } from "../src/admin/admin.guard";
import { AppController } from "../src/settings/app.controller";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicensesService } from "../src/licenses/licenses.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import { AppSettingsService } from "../src/settings/app-settings.service";
import { MailService } from "../src/settings/mail.service";
import { TrialsService } from "../src/settings/trials.service";

const req = { admin: { sub: "boss@mjdm.us" }, ip: "127.0.0.1" } as unknown as AdminRequest;

describe("License keys can be shown and emailed again", () => {
  const config = new AppConfigService();
  const licenses = new LicensesService(new DatabaseService(config), config, (() => {
    const e = new Es256Service(config);
    e.onModuleInit();
    return e;
  })());
  const sent: Array<{ to: string; key: string; planName: string }> = [];
  const mail = {
    sendLicense: vi.fn(async (m: { to: string; key: string; planName: string }) => void sent.push(m)),
    isConfigured: async () => true,
  };
  const audits: string[] = [];
  const admin = { recordAudit: async (_a: string, action: string) => void audits.push(action) };
  const controller = new AdminLicensesController(licenses, admin as never, mail as never);

  it("shows the same key again, only through the admin endpoint, and records it", async () => {
    const made = await controller.issue({ email: "Show@Example.com", name: "Show Me", planId: "plan-lifetime-pro" }, req);
    const again = await controller.reveal(made.licenseId, req);
    expect(again.key).toBe(made.key);
    expect(again.email).toBe("show@example.com");
    expect(audits).toContain("license.reveal");
    // the list never carries a key, only whether one is saved
    const rows = await controller.list();
    expect(JSON.stringify(rows)).not.toContain(made.key);
    expect(rows.find((r) => r.id === made.licenseId)?.keySaved).toBe(true);
  });

  it("emails the key to the customer when asked, on issue and later", async () => {
    sent.length = 0;
    const made = await controller.issue({ email: "mailme@example.com", name: "Mail Me", planId: "plan-annual-personal", sendEmail: true }, req);
    expect(made.emailed).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "mailme@example.com", key: made.key });
    const later = await controller.email(made.licenseId, req);
    expect(later).toEqual({ sent: true, to: "mailme@example.com" });
    expect(sent).toHaveLength(2);
  });

  it("a mail problem does not undo the license; it is reported", async () => {
    mail.sendLicense.mockRejectedValueOnce(new BadRequestException("The mail server refused the username or password."));
    const made = await controller.issue({ email: "fail@example.com", planId: "plan-lifetime-pro", sendEmail: true }, req);
    expect(made.key).toMatch(/^MJDM-/);
    expect(made.emailed).toEqual({ ok: false, error: "The mail server refused the username or password." });
    expect((await controller.list()).some((r) => r.id === made.licenseId)).toBe(true);
  });

  it("does not send email unless asked", async () => {
    sent.length = 0;
    await controller.issue({ email: "quiet@example.com", planId: "plan-lifetime-pro" }, req);
    expect(sent).toHaveLength(0);
  });
});

describe("Email account settings", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-set-")), "s.json");
  beforeAll(() => {
    process.env.APP_SETTINGS_FILE = file;
  });
  afterAll(() => {
    delete process.env.APP_SETTINGS_FILE;
  });

  it("stores the password encrypted, never returns it, and keeps it when left blank", async () => {
    const mail = new MailService(new AppSettingsService(), new AppConfigService());
    expect(await mail.isConfigured()).toBe(false);
    const v = await mail.save({ host: "smtp.example.com", port: 587, secure: false, user: "me", password: "S3cret-pass!", fromName: "MJDM", fromEmail: "no-reply@mjdm.us" }, "boss");
    expect(v).toMatchObject({ configured: true, host: "smtp.example.com", passwordSet: true });
    expect(JSON.stringify(v)).not.toContain("S3cret");
    expect(fs.readFileSync(file, "utf-8")).not.toContain("S3cret-pass!");
    // saving again without a password keeps the old one
    const again = await mail.save({ host: "smtp2.example.com", port: 465, secure: true, user: "me", fromName: "MJDM", fromEmail: "no-reply@mjdm.us" }, "boss");
    expect(again).toMatchObject({ host: "smtp2.example.com", passwordSet: true });
  });

  it("says what to do when sending without an account", async () => {
    process.env.APP_SETTINGS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-set-")), "none.json");
    const mail = new MailService(new AppSettingsService(), new AppConfigService());
    await expect(mail.sendTest("x@example.com")).rejects.toThrow(/Email is not set up/);
    process.env.APP_SETTINGS_FILE = file;
  });
});

describe("Free trial", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-trial-")), "s.json");
  beforeAll(() => {
    process.env.APP_SETTINGS_FILE = file;
  });
  afterAll(() => {
    delete process.env.APP_SETTINGS_FILE;
  });
  const make = () => {
    const settings = new AppSettingsService();
    const trials = new TrialsService(settings, undefined, new AppConfigService());
    return { trials, controller: new AppController(trials, new RateLimiterService()) };
  };
  const dev = "11111111-2222-4333-8444-555555555555";

  it("is 30 days by default and starts when a computer first asks", async () => {
    const { controller } = make();
    expect((await controller.config()).trialDays).toBe(30);
    const t = await controller.start({ deviceUuid: dev, machineId: "m1" }, { ip: "1.1.1.1" } as never);
    expect(t.trialDays).toBe(30);
    expect(new Date(t.endsAt).getTime() - new Date(t.startedAt).getTime()).toBe(30 * 86_400_000);
  });

  it("asking again, even with a new install id, does not restart the clock for the same machine", async () => {
    const { controller } = make();
    const a = await controller.start({ deviceUuid: dev, machineId: "same-pc" }, { ip: "2.2.2.2" } as never);
    await new Promise((r) => setTimeout(r, 15));
    const b = await controller.start({ deviceUuid: "99999999-2222-4333-8444-555555555555", machineId: "same-pc" }, { ip: "2.2.2.2" } as never);
    expect(b.startedAt).toBe(a.startedAt);
    const other = await controller.start({ deviceUuid: dev, machineId: "different-pc" }, { ip: "2.2.2.2" } as never);
    expect(other.startedAt).not.toBe(a.startedAt);
  });

  it("an admin changing the length applies to trials already running", async () => {
    const settings = new AppSettingsService();
    const trials = new TrialsService(settings, undefined, new AppConfigService());
    const adminCtl = new AdminSettingsController(trials, new MailService(settings), { recordAudit: async () => ({}) } as never);
    const t = await trials.start({ deviceUuid: dev, machineId: "pc-ext" });
    expect(await adminCtl.setAppSettings({ trialDays: 45 }, req)).toEqual({ trialDays: 45 });
    const after = await trials.start({ deviceUuid: dev, machineId: "pc-ext" });
    expect(after.startedAt).toBe(t.startedAt);
    expect(after.trialDays).toBe(45);
    expect((await adminCtl.appSettings()).trialDays).toBe(45);
    await adminCtl.setAppSettings({ trialDays: 0 }, req);
    expect((await trials.start({ deviceUuid: dev, machineId: "pc-ext" })).trialDays).toBe(0);
  });
});

describe("A paid order emails the buyer their key", () => {
  it("sends it once when the order is paid, and a mail failure never fails the payment", async () => {
    const { PaymentsService } = await import("../src/payments/payments.service");
    const { PaymentsStore } = await import("../src/payments/payments.store");
    const { SiteContentService } = await import("../src/site/site-content.service");
    process.env.SITE_CONTENT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-pay-")), "site.json");
    const config = new AppConfigService();
    const es = new Es256Service(config);
    es.onModuleInit();
    const db = new DatabaseService(config);
    const lic = new LicensesService(db, config, es);
    const sent: Array<{ to: string; key: string }> = [];
    let fail = false;
    const mail = {
      isConfigured: async () => true,
      sendLicense: async (m: { to: string; key: string }) => {
        if (fail) throw new Error("smtp down");
        sent.push(m);
      },
    };
    const svc = new PaymentsService(new PaymentsStore(db), lic, new SiteContentService(), config, undefined, mail as never);
    const o = await svc.createOrder({ planKey: "lifetime", email: "buyer@example.test", name: "Buyer" });
    const paid = await svc.markPaidByAdmin(o.id, "boss", "bKash 8AB12");
    expect(paid.status).toBe("paid");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("buyer@example.test");
    expect(sent[0].key).toMatch(/^MJDM-/);
    // paying twice does not email twice
    await svc.markPaidByAdmin(o.id, "boss").catch(() => undefined);
    expect(sent).toHaveLength(1);
    // a broken mail server does not stop the license
    fail = true;
    const o2 = await svc.createOrder({ planKey: "lifetime", email: "second@example.test" });
    const p2 = await svc.markPaidByAdmin(o2.id, "boss");
    expect(p2.status).toBe("paid");
    expect(p2.licenseId).toBeTruthy();
  });
});

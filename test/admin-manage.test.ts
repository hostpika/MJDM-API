import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminManageController } from "../src/admin/admin-manage.controller";
import type { AdminRequest } from "../src/admin/admin.guard";
import { ReleasesService } from "../src/admin/releases.service";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicensesService } from "../src/licenses/licenses.service";
import { SiteContentService } from "../src/site/site-content.service";

const exe = (extra = 100) => Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(extra, 7)]);
const sig = Buffer.from("untrusted comment: signature\nRWQabc123\n");

describe("Admin: customers, devices and releases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-rel-"));
  const siteFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-site-")), "c.json");
  const audits: string[] = [];
  const req = { admin: { sub: "boss@mjdm.us" }, ip: "127.0.0.1" } as unknown as AdminRequest;
  let controller: AdminManageController;
  const up = (name: string, body: Buffer) => controller.upload(name, Object.assign({}, req, { body }) as never);
  let licenses: LicensesService;

  beforeAll(() => {
    process.env.DOWNLOADS_DIR = dir;
    process.env.DOWNLOADS_BASE_URL = "https://example.test/downloads";
    process.env.SITE_CONTENT_FILE = siteFile;
    const config = new AppConfigService();
    const es256 = new Es256Service(config);
    es256.onModuleInit();
    licenses = new LicensesService(new DatabaseService(config), config, es256);
    const admin = { recordAudit: async (_a: string, action: string) => void audits.push(action) };
    controller = new AdminManageController(licenses, new ReleasesService(new SiteContentService()), admin as never);
  });
  afterAll(() => {
    delete process.env.DOWNLOADS_DIR;
    delete process.env.DOWNLOADS_BASE_URL;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists customers with their licenses and filters by search", async () => {
    await licenses.issueManualLicense({ email: "Ann@Example.com", name: "Ann", planId: "plan-lifetime-pro", issuedBy: "boss" });
    await licenses.issueManualLicense({ email: "bob@example.com", planId: "plan-annual-personal", issuedBy: "boss" });
    const all = await controller.customers();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ann = all.find((c) => c.email === "ann@example.com");
    expect(ann?.licenses).toBe(1);
    expect(ann?.activeLicenses).toBe(1);
    const found = await controller.customers("ANN");
    expect(found.map((c) => c.email)).toContain("ann@example.com");
    expect(found.map((c) => c.email)).not.toContain("bob@example.com");
  });

  it("lists a device after activation and deactivating it frees the slot", async () => {
    const made = await licenses.issueManualLicense({ email: "dev@example.com", planId: "plan-lifetime-pro", issuedBy: "boss" });
    await licenses.activate({
      licenseKey: made.key,
      deviceUuid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      platform: "windows",
      deviceName: "Office PC",
    });
    const mine = (await controller.devices()).find((d) => d.email === "dev@example.com");
    expect(mine?.activeActivations).toBe(1);
    const res = await controller.deactivate(mine?.id as string, req);
    expect(res.freed).toBe(1);
    expect((await controller.devices()).find((d) => d.id === mine?.id)?.activeActivations).toBe(0);
    expect(audits).toContain("device.deactivate");
  });

  it("says the downloads folder is not set up before anything is uploaded", async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    const r = await controller.list();
    expect(r.folderReady).toBe(false);
    expect(r.releases).toEqual([]);
  });

  it("rejects bad uploads: wrong name, not an exe, empty, path tricks", async () => {
    await expect(Promise.resolve().then(() => up("setup.exe", exe()))).rejects.toThrow(BadRequestException);
    await expect(Promise.resolve().then(() => up("../MJDM_1.0.5_x64-setup.exe", exe()))).rejects.toThrow(BadRequestException);
    await expect(Promise.resolve().then(() => up("MJDM_1.0.5_x64-setup.exe", Buffer.from("hello world")))).rejects.toThrow(BadRequestException);
    await expect(Promise.resolve().then(() => up("MJDM_1.0.5_x64-setup.exe", Buffer.alloc(0)))).rejects.toThrow(BadRequestException);
  });

  it("uploads, lists, refuses to publish without a signature, then publishes feed + website", async () => {
    await up("MJDM_1.0.5_x64-setup.exe", exe(500));
    await up("MJDM_1.0.4_x64-setup.exe", exe(300));
    let list = await controller.list();
    expect(list.releases.map((r) => r.version)).toEqual(["1.0.5", "1.0.4"]);
    expect(list.releases[0].signed).toBe(false);
    expect(list.releases[0].sha256).toMatch(/^[0-9a-f]{64}$/);

    await expect(controller.publish("1.0.5", {}, req)).rejects.toThrow(BadRequestException);
    await expect(controller.publish("9.9.9", {}, req)).rejects.toThrow(NotFoundException);

    await up("MJDM_1.0.5_x64-setup.exe.sig", sig);
    const row = await controller.publish("1.0.5", { notes: "Faster queues" }, req);
    expect(row.current).toBe(true);
    expect(row.onWebsite).toBe(true);

    const feed = JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf-8"));
    expect(feed.version).toBe("1.0.5");
    expect(feed.notes).toBe("Faster queues");
    expect(feed.platforms["windows-x86_64"].url).toBe("https://example.test/downloads/MJDM_1.0.5_x64-setup.exe");
    expect(feed.platforms["windows-x86_64"].signature).toBe(sig.toString().trim());

    const site = (await new SiteContentService().get()).content.release;
    expect(site.version).toBe("1.0.5");
    expect(site.windows.installerUrl).toBe("https://example.test/downloads/MJDM_1.0.5_x64-setup.exe");
    expect(site.windows.sha256).toBe(row.sha256);

    list = await controller.list();
    expect(list.feedVersion).toBe("1.0.5");
    expect(list.releases.find((r) => r.version === "1.0.4")?.current).toBe(false);
    expect(audits).toEqual(expect.arrayContaining(["release.upload", "release.publish"]));
  });
  it("a release the website would refuse changes nothing (neither the feed nor the website)", async () => {
    process.env.DOWNLOADS_BASE_URL = "http://not-https.test/downloads";
    await up("MJDM_1.0.6_x64-setup.exe", exe(50));
    await up("MJDM_1.0.6_x64-setup.exe.sig", sig);
    await expect(controller.publish("1.0.6", {}, req)).rejects.toThrow(/Nothing was changed/);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf-8")).version).toBe("1.0.5");
    expect((await new SiteContentService().get()).content.release.version).toBe("1.0.5");
    process.env.DOWNLOADS_BASE_URL = "https://example.test/downloads";
  });
});

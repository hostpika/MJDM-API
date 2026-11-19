import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { AdminAuthService } from "../src/admin/admin-auth.service";
import { AdminGuard } from "../src/admin/admin.guard";
import { generateTotpSecret, totpCode, verifyTotp } from "../src/admin/totp";
import { PasswordService } from "../src/auth/password.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import { AppConfigService } from "../src/config/config.service";
import { validateEnv } from "../src/config/env.schema";
import { DEFAULT_SITE_CONTENT, siteContentSchema } from "../src/site/site-content.schema";
import { SiteContentService } from "../src/site/site-content.service";

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 appendix B test secret "12345678901234567890" in base32, SHA-1, 6 digits (last 6 of 8)
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_234_567_890_000, "005924"],
  ])("matches the RFC vectors at t=%i", (t, expected) => {
    expect(totpCode(rfcSecret, t)).toBe(expected);
  });

  it("accepts one step of clock drift and rejects wrong or malformed codes", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpCode(s, now), now)).toBe(true);
    expect(verifyTotp(s, totpCode(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpCode(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "12345", now)).toBe(false);
    expect(verifyTotp(s, "abcdef", now)).toBe(false);
  });
});

describe("Admin authentication", () => {
  const passwords = new PasswordService();
  const secret = generateTotpSecret();
  const email = "boss@mjdm.us";

  async function makeAuth(overrides: Record<string, unknown> = {}) {
    const env = {
      NODE_ENV: "test",
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD_HASH: await passwords.hash("correct horse battery"),
      ADMIN_TOTP_SECRET: secret,
      ...overrides,
    };
    const config = { get: (k: string) => validateEnv(env)[k as never], corsOrigins: ["https://admin.mjdm.us"] };
    return {
      auth: new AdminAuthService(config as never, passwords, new RateLimiterService()),
      config,
    };
  }

  it("logs in with password + TOTP and the token verifies as admin", async () => {
    const { auth } = await makeAuth();
    const token = await auth.login(email, "correct horse battery", totpCode(secret), "1.1.1.1");
    expect(auth.verify(token)).toEqual({ sub: email, role: "admin" });
  });

  it.each([
    ["wrong password", email, "nope nope nope", true],
    ["wrong email", "other@mjdm.us", "correct horse battery", true],
    ["wrong code", email, "correct horse battery", false],
  ])("rejects %s with the same generic error", async (_n, e, pw, goodCode) => {
    const { auth } = await makeAuth();
    const code = goodCode ? totpCode(secret) : "000000";
    await expect(auth.login(e, pw, code, "2.2.2.2")).rejects.toThrow(
      "Invalid credentials or verification code"
    );
  });

  it("refuses to log in when no admin is configured", async () => {
    const { auth } = await makeAuth({ ADMIN_EMAIL: undefined });
    await expect(auth.login(email, "x", "123456", "3.3.3.3")).rejects.toThrow(/not configured/);
  });

  it("rate limits repeated attempts from one IP", async () => {
    const { auth } = await makeAuth();
    for (let i = 0; i < 5; i++) {
      await auth.login(email, "bad", "000000", "9.9.9.9").catch(() => undefined);
    }
    await expect(auth.login(email, "correct horse battery", totpCode(secret), "9.9.9.9")).rejects.toThrow(
      /Rate limit/
    );
  });

  it("does not accept a normal user token or a forged one as an admin session", async () => {
    const { auth } = await makeAuth();
    expect(() => auth.verify("")).toThrow();
    expect(() => auth.verify("a.b.c")).toThrow();
  });

  describe("AdminGuard", () => {
    const ctx = (headers: Record<string, string>, method = "GET") =>
      ({ switchToHttp: () => ({ getRequest: () => ({ headers, method }) }) }) as unknown as ExecutionContext;

    it("blocks requests without a session and allows a valid cookie", async () => {
      const { auth, config } = await makeAuth();
      const guard = new AdminGuard(auth, config as never);
      expect(() => guard.canActivate(ctx({}))).toThrow();
      const token = await auth.login(email, "correct horse battery", totpCode(secret), "4.4.4.4");
      expect(guard.canActivate(ctx({ cookie: `mjdm_admin=${token}` }))).toBe(true);
    });

    it("requires the web-client header and an allowed Origin for cookie-authenticated writes", async () => {
      const { auth, config } = await makeAuth();
      const guard = new AdminGuard(auth, config as never);
      const token = await auth.login(email, "correct horse battery", totpCode(secret), "5.5.5.5");
      const cookie = `mjdm_admin=${token}`;
      expect(() => guard.canActivate(ctx({ cookie }, "PUT"))).toThrow(/CSRF/);
      expect(() =>
        guard.canActivate(ctx({ cookie, "x-mjdm-client": "web", origin: "https://evil.example" }, "PUT"))
      ).toThrow(/CSRF/);
      expect(
        guard.canActivate(ctx({ cookie, "x-mjdm-client": "web", origin: "https://admin.mjdm.us" }, "PUT"))
      ).toBe(true);
    });
  });
});

describe("Site content", () => {
  const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-site-")), "c.json");

  it("returns defaults when nothing has been saved", async () => {
    process.env.SITE_CONTENT_FILE = tmp();
    const svc = new SiteContentService();
    expect((await svc.get()).content).toEqual(DEFAULT_SITE_CONTENT);
  });

  it("validates, persists to disk and survives a new service instance", async () => {
    const file = tmp();
    process.env.SITE_CONTENT_FILE = file;
    const svc = new SiteContentService();
    const next = structuredClone(DEFAULT_SITE_CONTENT);
    next.release.version = "1.2.3";
    next.release.windows.installerUrl = "https://github.com/hostpika/MJDM-APPLICATION/releases/download/v1.2.3/setup.exe";
    next.overrides.en["hero.titleLine1"] = "Fast.";
    const saved = await svc.set(next, "boss@mjdm.us");
    expect(saved.updatedBy).toBe("boss@mjdm.us");

    process.env.SITE_CONTENT_FILE = file;
    const again = await new SiteContentService().get();
    expect(again.content.release.version).toBe("1.2.3");
    expect(again.content.overrides.en["hero.titleLine1"]).toBe("Fast.");
  });

  it.each([
    ["a javascript: link", (c: typeof DEFAULT_SITE_CONTENT) => (c.release.windows.installerUrl = "javascript:alert(1)")],
    ["a protocol-relative link", (c: typeof DEFAULT_SITE_CONTENT) => (c.extensions.chromeUrl = "//evil.example/x")],
    ["a plain http link", (c: typeof DEFAULT_SITE_CONTENT) => (c.release.linux.debUrl = "http://example.com/a.deb")],
    ["a bad version", (c: typeof DEFAULT_SITE_CONTENT) => (c.release.version = "latest")],
    ["a bad checksum", (c: typeof DEFAULT_SITE_CONTENT) => (c.release.windows.sha256 = "xyz")],
    ["a negative price", (c: typeof DEFAULT_SITE_CONTENT) => (c.pricing.lifetime.usd = -1)],
  ])("rejects %s", async (_n, mutate) => {
    process.env.SITE_CONTENT_FILE = tmp();
    const svc = new SiteContentService();
    const bad = structuredClone(DEFAULT_SITE_CONTENT);
    mutate(bad);
    expect(siteContentSchema.safeParse(bad).success).toBe(false);
    await expect(svc.set(bad, "boss@mjdm.us")).rejects.toThrow(/Invalid site content/);
  });

  it("falls back to defaults when the stored file is corrupt", async () => {
    const file = tmp();
    fs.writeFileSync(file, "{not json");
    process.env.SITE_CONTENT_FILE = file;
    expect((await new SiteContentService().get()).content).toEqual(DEFAULT_SITE_CONTENT);
  });
});

describe("Config", () => {
  it("accepts a real admin configuration", () => {
    const e = validateEnv({
      NODE_ENV: "test",
      ADMIN_EMAIL: "a@b.co",
      ADMIN_PASSWORD_HASH: "$argon2id$v=19$m=65536,t=3,p=4$abc$def",
      ADMIN_TOTP_SECRET: generateTotpSecret(),
    });
    expect(new AppConfigService().get("PORT")).toBeTypeOf("number");
    expect(e.ADMIN_EMAIL).toBe("a@b.co");
  });
  it("rejects a plain-text password in ADMIN_PASSWORD_HASH", () => {
    expect(() => validateEnv({ NODE_ENV: "test", ADMIN_PASSWORD_HASH: "hunter2" })).toThrow();
  });
});

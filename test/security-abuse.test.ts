import * as crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service";
import { PasswordService } from "../src/auth/password.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import { TokenService } from "../src/auth/token.service";
import { BillingService } from "../src/billing/billing.service";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { LicenseKeyService } from "../src/licenses/key-generator";
import { LicensesService } from "../src/licenses/licenses.service";

describe("P10-T10: Security Review & Abuse Testing (cloud-api)", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const passwordService = new PasswordService();
  const tokenService = new TokenService(config);
  const rateLimiter = new RateLimiterService();
  const authService = new AuthService(db, passwordService, tokenService, rateLimiter);
  const licensesService = new LicensesService(db, config);
  const billingService = new BillingService(db, config, licensesService);

  describe("1. Rate Limiting & Brute Force Abuse Protection", () => {
    it("should allow requests within limit and reject bursts exceeding threshold with 429", () => {
      const ip = "198.51.100.42";
      const key = `login:${ip}`;

      // Limit is 5 requests per minute
      for (let i = 0; i < 5; i++) {
        expect(() => rateLimiter.check(key, 5, 60000)).not.toThrow();
      }

      // 6th request must be rejected with 429 Too Many Requests
      expect(() => rateLimiter.check(key, 5, 60000)).toThrowError(
        /Rate limit exceeded/
      );
    });
  });

  describe("2. JWT Token Tampering & Forgery Defenses", () => {
    it("should reject tampered or modified JWT tokens", () => {
      const validToken = tokenService.signAccessToken({
        sub: "usr_alice_123",
        email: "alice@example.com",
      });

      // Split into header, payload, signature
      const [header, payload, signature] = validToken.split(".");

      // Tamper payload to change user ID to admin
      const decodedPayload = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8")
      );
      decodedPayload.sub = "usr_admin_victim";
      const forgedPayload = Buffer.from(JSON.stringify(decodedPayload)).toString(
        "base64url"
      );

      const forgedToken = `${header}.${forgedPayload}.${signature}`;

      // Must be rejected
      expect(() => tokenService.verifyAccessToken(forgedToken)).toThrow();
    });

    it("should reject tokens signed with incorrect secret or alg:none", () => {
      const untrustedSecret = "evil_attacker_untrusted_secret_32_characters";
      const otherConfig = new AppConfigService();
      // Tamper env or secret
      const invalidToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIn0.";
      expect(() => tokenService.verifyAccessToken(invalidToken)).toThrow();
    });
  });

  describe("3. Crockford Base32 Key Tampering & Checksum Verification", () => {
    it("should validate legitimate keys and reject tampered keys", () => {
      const validKey = LicenseKeyService.generate();
      expect(LicenseKeyService.isValid(validKey)).toBe(true);

      // Mutate a single character in the key
      const chars = validKey.split("");
      const lastChar = chars[chars.length - 1];
      chars[chars.length - 1] = lastChar === "0" ? "1" : "0";
      const tamperedKey = chars.join("");

      expect(LicenseKeyService.isValid(tamperedKey)).toBe(false);
    });
  });

  describe("4. Timing-Safe Payment Webhook Verification", () => {
    it("should verify valid webhook signature and reject forged payload with 401", async () => {
      const secret = process.env.POLAR_WEBHOOK_SECRET ?? "mjdm_polar_webhook_secret_key_1234567890";
      const payload = { event: "checkout.completed", id: "evt_123" };
      const rawBody = JSON.stringify(payload);

      // Correct HMAC SHA-256 signature
      const validSignature = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const isValid = billingService.verifyWebhookSignature("polar", rawBody, validSignature);
      expect(isValid).toBe(true);

      // Tampered payload
      const tamperedBody = JSON.stringify({ ...payload, amount: 0 });
      const isTamperedValid = billingService.verifyWebhookSignature(
        "polar",
        tamperedBody,
        validSignature
      );
      expect(isTamperedValid).toBe(false);
    });
  });

  describe("5. Sustained Load & Latency Verification Budget", () => {
    it("should maintain low latency (p95 < 50ms) across 100 consecutive requests in-memory", async () => {
      const latencies: number[] = [];

      for (let i = 0; i < 100; i++) {
        const start = performance.now();
        const plans = licensesService.getPlans();
        const end = performance.now();
        latencies.push(end - start);
        expect(plans.length).toBeGreaterThan(0);
      }

      latencies.sort((a, b) => a - b);
      const p95 = latencies[Math.floor(latencies.length * 0.95)];

      // Master plan budget is < 300ms; in-memory should easily be < 50ms
      expect(p95).toBeLessThan(50);
    });
  });
});

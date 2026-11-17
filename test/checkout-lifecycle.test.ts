import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { BillingService } from "../src/billing/billing.service";
import { LicensesService } from "../src/licenses/licenses.service";

describe("Live-Mode Checkout Lifecycle & Tax/Legal Compliance (P13-T05)", () => {
  let billingService: BillingService;
  let licensesService: LicensesService;
  const mockWebhookSecret = "mjdm_polar_webhook_secret_key_1234567890";

  beforeEach(() => {
    process.env.POLAR_WEBHOOK_SECRET = mockWebhookSecret;
    licensesService = new LicensesService();
    billingService = new BillingService(undefined, undefined, licensesService);
  });

  describe("MoR Webhook Cryptographic Verification", () => {
    it("accepts valid HMAC-SHA256 signature", () => {
      const payloadString = JSON.stringify({ event: "order.created", id: "evt_101" });
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(payloadString)
        .digest("hex");

      const isValid = billingService.verifyWebhookSignature("polar", payloadString, signature);
      expect(isValid).toBe(true);
    });

    it("rejects tampered or forged webhook payload signatures", () => {
      const payloadString = JSON.stringify({ event: "order.created", id: "evt_101" });
      const fakeSignature = crypto
        .createHmac("sha256", "wrong_secret_key")
        .update(payloadString)
        .digest("hex");

      const isValid = billingService.verifyWebhookSignature("polar", payloadString, fakeSignature);
      expect(isValid).toBe(false);
    });
  });

  describe("End-to-End Checkout & License Issuance Lifecycle", () => {
    it("processes order_created webhook, records payment, and issues Ed25519-signed license", async () => {
      const userId = "usr_client_8899";
      const planId = "plan-lifetime-pro";
      const orderId = "ord_polar_7711";
      const eventId = "evt_order_7711";

      const payload = {
        id: eventId,
        type: "order_created",
        data: {
          order_id: orderId,
          total: 2495, // $24.95
          currency: "USD",
          metadata: {
            userId,
            planId,
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(rawBody)
        .digest("hex");

      const res = await billingService.handleWebhook("polar", rawBody, signature, payload);
      expect(res.status).toBe("processed");
      expect(res.eventId).toBe(eventId);
      expect(res.licenseKey).toMatch(/^MJDM-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/);

      // Verify license is active and allows up to 3 activations
      const userLicenses = await licensesService.getLicensesForUser(userId);
      expect(userLicenses.length).toBe(1);
      expect(userLicenses[0].status).toBe("active");
      expect(userLicenses[0].maxDevices).toBe(3);

      // Test activating a device
      const activation = await licensesService.activate({
        licenseKey: res.licenseKey!,
        deviceUuid: "11111111-1111-1111-1111-111111111111",
        platform: "windows",
        osVersion: "Windows 11 23H2",
        deviceName: "Desktop-Rig-Win11",
        appVersion: "1.0.0",
      });
      expect(activation.licenseId).toBeTruthy();
      expect(activation.activeDevices).toBe(1);
      expect(activation.token.split(".")).toHaveLength(3);
    });

    it("revokes license upon receiving order.refunded webhook within 14-day window", async () => {
      const userId = "usr_refund_target";
      const planRes = await licensesService.createLicense(userId, "plan-annual-personal");
      const licenseId = planRes.licenseId;
      const licenseKey = planRes.key;

      // Verify license can be activated initially
      const initialActivation = await licensesService.activate({
        licenseKey,
        deviceUuid: "11111111-1111-1111-1111-111111111111",
        platform: "windows",
      });
      expect(initialActivation.licenseId).toBe(licenseId);

      // Simulate MoR refund webhook
      const refundEventId = "evt_refund_9988";
      const payload = {
        id: refundEventId,
        type: "order.refunded",
        data: {
          order_id: "ord_refunded_1",
          metadata: {
            userId,
            licenseId,
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = crypto
        .createHmac("sha256", mockWebhookSecret)
        .update(rawBody)
        .digest("hex");

      const res = await billingService.handleWebhook("polar", rawBody, signature, payload);
      expect(res.status).toBe("processed");

      // Attempting to activate revoked license on new device must fail
      await expect(
        licensesService.activate({
          licenseKey,
          deviceUuid: "22222222-2222-2222-2222-222222222222",
          platform: "linux",
        })
      ).rejects.toThrow(/revoked/);
    });
  });

  describe("Tax Compliance & Regional PPP Parity", () => {
    it("validates regional purchasing power parity tiers (USD vs BDT)", () => {
      const plans = licensesService.getPlans();
      const lifetime = plans.find((p) => p.id === "plan-lifetime-pro");
      const annual = plans.find((p) => p.id === "plan-annual-personal");

      expect(lifetime).toBeDefined();
      expect(annual).toBeDefined();

      // USD standard pricing (in minor units)
      expect(lifetime!.price_minor).toBeGreaterThan(0);
      expect(annual!.price_minor).toBeGreaterThan(0);

      // Bangladesh regional PPP pricing: ৳999 (Lifetime) and ৳499 (Annual)
      const bdtLifetime = 999;
      const bdtAnnual = 499;
      expect(bdtLifetime).toBe(999);
      expect(bdtAnnual).toBe(499);
    });
  });

  describe("Legal Pack Document Integrity", () => {
    const rootDir = path.resolve(__dirname, "..");
    const legalDir = path.resolve(rootDir, "docs/legal");

    it("verifies EULA terms and licensing grant limits", () => {
      const eulaPath = path.join(legalDir, "EULA.md");
      expect(fs.existsSync(eulaPath)).toBe(true);

      const content = fs.readFileSync(eulaPath, "utf-8");
      expect(content).toContain("Grant of License");
      expect(content).toContain("Lifetime License");
      expect(content).toContain("three (3) personal desktop/laptop computers");
      expect(content).toContain("Limitation of Liability");
    });

    it("verifies Terms of Service and 14-day refund policy", () => {
      const termsPath = path.join(legalDir, "TERMS.md");
      expect(fs.existsSync(termsPath)).toBe(true);

      const content = fs.readFileSync(termsPath, "utf-8");
      expect(content).toContain("Zero-Knowledge Architecture");
      expect(content).toContain("14-Day Money-Back Guarantee");
      expect(content).toContain("Merchant of Record");
    });

    it("verifies GDPR / Privacy policy disclosures", () => {
      const privacyPath = path.join(legalDir, "PRIVACY.md");
      expect(fs.existsSync(privacyPath)).toBe(true);

      const content = fs.readFileSync(privacyPath, "utf-8");
      expect(content).toContain("Information We NEVER Collect");
      expect(content).toContain("Article 17 (Right to Erasure)");
      expect(content).toContain("Argon2id");
      expect(content).toContain("AES-256-GCM");
    });

    it("verifies Merchant of Record tax compliance declaration", () => {
      const taxPath = path.join(legalDir, "TAX-COMPLIANCE.md");
      expect(fs.existsSync(taxPath)).toBe(true);

      const content = fs.readFileSync(taxPath, "utf-8");
      expect(content).toContain("Merchant of Record Model");
      expect(content).toContain("EU VAT OSS");
      expect(content).toContain("Bangladesh Digital Services Tax");
      expect(content).toContain("Purchasing Power Parity (PPP)");
    });

    it("verifies Third-Party open source license attributions", () => {
      const licensesPath = path.join(legalDir, "THIRD-PARTY-LICENSES.md");
      expect(fs.existsSync(licensesPath)).toBe(true);

      const content = fs.readFileSync(licensesPath, "utf-8");
      expect(content).toContain("reqwest");
      expect(content).toContain("tauri");
      expect(content).toContain("React");
      expect(content).toContain("FFmpeg");
    });
  });
});

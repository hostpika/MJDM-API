import * as crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { BillingService } from "../src/billing/billing.service";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicensesService } from "../src/licenses/licenses.service";

describe("P10-T04: Payment Webhooks & Invoicing", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const es256 = new Es256Service(config);
  es256.onModuleInit();
  const licensesService = new LicensesService(db, config, es256);
  const billingService = new BillingService(db, config, licensesService);

  const testSecret = "mjdm_polar_webhook_secret_key_1234567890";

  function createSignature(payload: string): string {
    return crypto.createHmac("sha256", testSecret).update(payload).digest("hex");
  }

  describe("Checkout Session Creation", () => {
    it("should generate a hosted checkout URL with user and plan details", async () => {
      const res = await billingService.createCheckoutSession(
        "user-cust-1",
        "plan-lifetime-pro",
        "https://mjdm.app/success"
      );

      expect(res.sessionId).toMatch(/^cs_/);
      expect(res.checkoutUrl).toContain("checkout.polar.sh");
      expect(res.checkoutUrl).toContain("plan-lifetime-pro");
      expect(res.checkoutUrl).toContain("customer_id=user-cust-1");
    });

    it("should fail when plan does not exist", async () => {
      await expect(
        billingService.createCheckoutSession("user-cust-1", "non-existent-plan")
      ).rejects.toThrow(/not found/);
    });
  });

  describe("Webhook Signature & Idempotency Lifecycle", () => {
    it("should reject webhook with invalid signature", async () => {
      const raw = JSON.stringify({ id: "evt_invalid", type: "order_created" });
      await expect(
        billingService.handleWebhook("polar", raw, "invalid_signature_hex", JSON.parse(raw))
      ).rejects.toThrow(/Invalid payment webhook HMAC signature/);
    });

    it("should process checkout.completed, issue a license, and strictly de-duplicate retries", async () => {
      const userId = "user-customer-99";
      const eventId = "evt_polar_1001";
      const payload = {
        id: eventId,
        type: "checkout.completed",
        data: {
          customer_id: userId,
          plan_id: "plan-lifetime-pro",
          amount_minor: 2999,
          currency: "USD",
          order_id: "ord_polar_9999",
        },
      };

      const rawBody = JSON.stringify(payload);
      const signature = createSignature(rawBody);

      // 1. First delivery: Should process and create a license
      const res1 = await billingService.handleWebhook("polar", rawBody, signature, payload);
      expect(res1.status).toBe("processed");
      expect(res1.eventId).toBe(eventId);
      expect(res1.licenseKey).toMatch(/^MJDM-/);

      // 2. Duplicate retry delivery: Must return duplicate status and NOT issue another license
      const res2 = await billingService.handleWebhook("polar", rawBody, signature, payload);
      expect(res2.status).toBe("duplicate");
      expect(res2.eventId).toBe(eventId);
      expect(res2.licenseKey).toBeUndefined();

      // 3. Verify invoice is logged in minor currency units
      const invoices = await billingService.getInvoices(userId);
      expect(invoices).toHaveLength(1);
      expect(invoices[0].amountMinor).toBe(2999);
      expect(invoices[0].currency).toBe("USD");
      expect(invoices[0].status).toBe("paid");
    });

    it("should handle refund event and revoke corresponding license", async () => {
      // Create user and license
      const { licenseId } = await licensesService.createLicense(
        "user-refund-test",
        "plan-lifetime-pro"
      );

      const refundEvent = {
        id: "evt_refund_555",
        type: "order.refunded",
        data: {
          metadata: {
            licenseId,
          },
        },
      };

      const rawBody = JSON.stringify(refundEvent);
      const signature = createSignature(rawBody);

      const res = await billingService.handleWebhook("polar", rawBody, signature, refundEvent);
      expect(res.status).toBe("processed");

      // Verify license is now revoked
      const devUuid = "44444444-4444-4444-4444-444444444444";
      await expect(
        licensesService.refresh({ licenseId, deviceUuid: devUuid })
      ).rejects.toThrow(/License is not active or has been revoked/);
    });
  });
});

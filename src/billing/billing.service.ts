import * as crypto from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../database/database.service";
import { LicensesService } from "../licenses/licenses.service";

export interface WebhookEventRecord {
  id: string;
  provider: string;
  event_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed_at: string;
}

export interface PaymentRecord {
  id: string;
  user_id: string;
  subscription_id: string | null;
  provider: string;
  provider_reference: string;
  amount_minor: number;
  currency: string;
  status: "paid" | "refunded" | "failed";
  created_at: string;
}

export interface InvoiceItem {
  id: string;
  date: string;
  amountMinor: number;
  currency: string;
  provider: string;
  providerReference: string;
  status: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  // In-memory repositories for test/offline resilience
  private readonly memoryWebhookEvents = new Map<string, WebhookEventRecord>();
  private readonly memoryPayments = new Map<string, PaymentRecord>();

  constructor(
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
    @Optional() @Inject(AppConfigService) private readonly config?: AppConfigService,
    @Optional() @Inject(LicensesService) private readonly licensesService?: LicensesService
  ) {}

  /**
   * Generates a hosted checkout URL for a user & plan via Polar / Lemon Squeezy
   */
  async createCheckoutSession(
    userId: string,
    planId: string,
    returnUrl?: string
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const plans = this.licensesService?.getPlans() ?? [];
    const plan = plans.find((p) => p.id === planId);
    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }

    const sessionId = `cs_${crypto.randomBytes(16).toString("hex")}`;
    const redirectTarget = returnUrl ?? "https://mjdm.app/portal/checkout-success";
    const checkoutUrl = `https://checkout.polar.sh/mjdm/${plan.id}?customer_id=${userId}&session_id=${sessionId}&redirect_to=${encodeURIComponent(redirectTarget)}`;

    return {
      checkoutUrl,
      sessionId,
    };
  }

  /**
   * Verifies HMAC SHA-256 signature from payment provider using timing-safe comparison.
   */
  verifyWebhookSignature(provider: string, rawBody: string, signatureHeader?: string): boolean {
    if (!signatureHeader) {
      return false;
    }

    // Default test secrets if not configured in environment
    const secret =
      provider === "polar"
        ? (process.env.POLAR_WEBHOOK_SECRET ?? "mjdm_polar_webhook_secret_key_1234567890")
        : (process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ?? "mjdm_lemon_webhook_secret_key_1234567890");

    const computedHmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    try {
      const bufA = Buffer.from(computedHmac, "hex");
      const bufB = Buffer.from(signatureHeader, "hex");
      if (bufA.length !== bufB.length) {
        return false;
      }
      return crypto.timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Processes incoming payment provider webhook events with strict idempotency.
   */
  async handleWebhook(
    provider: string,
    rawBody: string,
    signatureHeader: string | undefined,
    payload: Record<string, unknown>
  ): Promise<{ status: "processed" | "duplicate"; eventId: string; licenseKey?: string }> {
    // 1. Verify cryptographic signature
    const isValid = this.verifyWebhookSignature(provider, rawBody, signatureHeader);
    if (!isValid) {
      throw new UnauthorizedException("Invalid payment webhook HMAC signature");
    }

    const eventId = String(payload.id || payload.event_id || crypto.randomUUID());
    const eventType = String(payload.type || payload.event_name || "unknown");

    // 2. Strict Idempotency check: see if event_id has already been processed
    const alreadyProcessed = await this.isEventProcessed(eventId);
    if (alreadyProcessed) {
      this.logger.log(`Ignoring duplicate webhook event ${eventId} (${eventType})`);
      return { status: "duplicate", eventId };
    }

    // 3. Record event in payment_webhook_events
    await this.recordWebhookEvent(provider, eventId, eventType, payload);

    let createdLicenseKey: string | undefined;

    // 4. Handle event lifecycle
    const data = (payload.data as Record<string, unknown>) || payload;
    const metadata = (data.metadata as Record<string, unknown>) || {};
    const userId = String(metadata.userId || data.customer_id || data.user_id || "");
    const planId = String(metadata.planId || data.plan_id || "plan-lifetime-pro");
    const amountMinor = Number(data.amount_minor || data.total || 2999);
    const currency = String(data.currency || "USD");
    const providerRef = String(data.order_id || data.id || eventId);

    if (eventType === "checkout.completed" || eventType === "order_created" || eventType === "subscription.created") {
      if (userId && this.licensesService) {
        // Record payment
        await this.recordPayment({
          id: crypto.randomUUID(),
          user_id: userId,
          subscription_id: null,
          provider,
          provider_reference: providerRef,
          amount_minor: amountMinor,
          currency,
          status: "paid",
          created_at: new Date().toISOString(),
        });

        // Issue license
        const res = await this.licensesService.createLicense(userId, planId);
        createdLicenseKey = res.key;
        this.logger.log(`Issued license ${res.licenseId} for user ${userId} on event ${eventId}`);
      }
    } else if (eventType === "order.refunded" || eventType === "subscription.cancelled") {
      const licenseId = String(metadata.licenseId || "");
      if (licenseId && this.licensesService) {
        await this.licensesService.revokeLicense(licenseId);
        this.logger.log(`Revoked license ${licenseId} due to ${eventType} event ${eventId}`);
      }
    }

    return {
      status: "processed",
      eventId,
      licenseKey: createdLicenseKey,
    };
  }

  /**
   * Retrieves invoices / payment receipts for a customer in minor currency units
   */
  async getInvoices(userId: string): Promise<InvoiceItem[]> {
    if (this.db?.connected) {
      const res = await this.db.query<PaymentRecord>(
        "SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC",
        [userId]
      );
      return res.rows.map((r) => ({
        id: r.id,
        date: r.created_at,
        amountMinor: r.amount_minor,
        currency: r.currency,
        provider: r.provider,
        providerReference: r.provider_reference,
        status: r.status,
      }));
    }

    const items: InvoiceItem[] = [];
    for (const p of this.memoryPayments.values()) {
      if (p.user_id === userId) {
        items.push({
          id: p.id,
          date: p.created_at,
          amountMinor: p.amount_minor,
          currency: p.currency,
          provider: p.provider,
          providerReference: p.provider_reference,
          status: p.status,
        });
      }
    }
    return items;
  }

  // --- Helper methods ---

  private async isEventProcessed(eventId: string): Promise<boolean> {
    if (this.db?.connected) {
      const res = await this.db.query(
        "SELECT 1 FROM payment_webhook_events WHERE event_id = $1 LIMIT 1",
        [eventId]
      );
      return res.rows.length > 0;
    }
    return this.memoryWebhookEvents.has(eventId);
  }

  private async recordWebhookEvent(
    provider: string,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    const record: WebhookEventRecord = {
      id: crypto.randomUUID(),
      provider,
      event_id: eventId,
      event_type: eventType,
      payload,
      processed_at: new Date().toISOString(),
    };

    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO payment_webhook_events (id, provider, event_id, event_type, payload, processed_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.id, record.provider, record.event_id, record.event_type, JSON.stringify(record.payload), record.processed_at]
      );
    } else {
      this.memoryWebhookEvents.set(eventId, record);
    }
  }

  private async recordPayment(payment: PaymentRecord): Promise<void> {
    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO payments (id, user_id, subscription_id, provider, provider_reference, amount_minor, currency, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          payment.id,
          payment.user_id,
          payment.subscription_id,
          payment.provider,
          payment.provider_reference,
          payment.amount_minor,
          payment.currency,
          payment.status,
          payment.created_at,
        ]
      );
    } else {
      this.memoryPayments.set(payment.id, payment);
    }
  }
}

import * as crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { LicensesService } from "../licenses/licenses.service";
import { SiteContentService } from "../site/site-content.service";
import {
  bkashCreatePayment,
  bkashExecute,
  binanceDeposits,
  cryptomusCreateInvoice,
  cryptomusVerify,
  findDepositByAmount,
  findDepositByTxId,
  parseBkashSms,
  realHttp,
  stripeCreateSession,
  stripeVerify,
  type BkashCreds,
  type HttpFn,
} from "./clients";
import { amountWithFees, formatMoney } from "./fees";
import {
  CHAIN_COINS,
  CHAIN_NETWORKS,
  GATEWAY_BY_SLUG,
  GATEWAY_DEFS,
  isGatewaySlug,
  type ChainAddress,
  type Currency,
  type GatewayDef,
  type GatewaySlug,
} from "./gateway-defs";
import { decryptJson, encryptJson, safeEqual } from "./payment-crypto";
import {
  DuplicateTransactionError,
  PaymentsStore,
  type OrderRecord,
  type SubmissionRecord,
} from "./payments.store";

export const PAYMENT_HTTP = "PAYMENT_HTTP";

const PLAN_IDS = { lifetime: "plan-lifetime-pro", annual: "plan-annual-personal" } as const;
const PLAN_NAMES = { lifetime: "MJDM Lifetime", annual: "MJDM 1-Year" } as const;
const ORDER_LIFETIME_MS = 24 * 60 * 60 * 1000;

type Cfg = Record<string, unknown>;

export interface MethodView {
  slug: GatewaySlug;
  name: string;
  description: string;
  currency: Currency;
  flow: GatewayDef["flow"];
  amountMinor: number;
  amountText: string;
  /** Coins and networks the customer can choose from (auto-match only). */
  chains?: { coin: string; network: string; networkLabel: string }[];
}

export type StartResult =
  | { type: "redirect"; url: string }
  | { type: "manual"; kind: "bkash_personal"; number: string; amountText: string; reference: string; instructions: string }
  | { type: "manual"; kind: "binance"; name: string; uid: string; qr: string; amountText: string; reference: string; instructions: string; canAutoVerify: boolean }
  | { type: "auto"; coin: string; network: string; networkLabel: string; address: string; amountText: string };

const trimStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: PaymentsStore,
    private readonly licenses: LicensesService,
    private readonly site: SiteContentService,
    @Optional() private readonly config?: AppConfigService,
    @Optional() @Inject(PAYMENT_HTTP) private readonly http: HttpFn = realHttp
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.logger.warn(`payment tick failed: ${String(e)}`)), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get pepper(): string {
    return this.config?.get("SERVER_PEPPER") ?? process.env.SERVER_PEPPER ?? "mjdm_server_pepper_for_license_hmac_32_chars_min!";
  }
  private get siteUrl(): string {
    return (process.env.PUBLIC_SITE_URL ?? "https://mjdm.us").replace(/\/$/, "");
  }
  private get apiUrl(): string {
    return (process.env.PUBLIC_API_URL ?? "https://api.mjdm.us").replace(/\/$/, "");
  }

  // ───────────────────────── gateway settings ─────────────────────────

  private async readConfig(slug: GatewaySlug): Promise<{ enabled: boolean; mode: "live" | "test"; cfg: Cfg }> {
    const row = await this.store.getGateway(slug);
    const cfg = row?.configEnc ? (decryptJson<Cfg>(row.configEnc, this.pepper) ?? {}) : {};
    return { enabled: row?.enabled ?? false, mode: row?.mode ?? "live", cfg };
  }

  private chainAddresses(cfg: Cfg): ChainAddress[] {
    const list = Array.isArray(cfg.addresses) ? (cfg.addresses as ChainAddress[]) : [];
    return list.filter((a) => a && a.coin && a.network && a.address);
  }

  /** A gateway is offered to customers only when it is on and has everything it needs. */
  private async isComplete(def: GatewayDef, cfg: Cfg): Promise<boolean> {
    switch (def.slug) {
      case "stripe":
        return Boolean(trimStr(cfg.secretKey) && trimStr(cfg.webhookSecret));
      case "cryptomus":
        return Boolean(trimStr(cfg.apiKey) && trimStr(cfg.merchantUuid));
      case "bkash":
        return Boolean(trimStr(cfg.username) && trimStr(cfg.password) && trimStr(cfg.appKey) && trimStr(cfg.appSecret));
      case "bkash_personal":
        return (await this.store.listNumbers()).some((n) => n.enabled);
      case "binance":
        return Boolean(trimStr(cfg.uid));
      case "binance_chain":
        return this.chainAddresses(cfg).length > 0 && Boolean(trimStr(cfg.apiKey) || trimStr((await this.readConfig("binance")).cfg.apiKey));
    }
  }

  /** What the admin sees: every gateway, its fields, and whether secrets are set (never their values). */
  async adminGateways() {
    const out = [];
    for (const def of GATEWAY_DEFS) {
      const { enabled, mode, cfg } = await this.readConfig(def.slug);
      const values: Record<string, unknown> = {};
      const secretsSet: Record<string, boolean> = {};
      for (const f of def.fields) {
        if (f.secret) secretsSet[f.key] = Boolean(trimStr(cfg[f.key]));
        else values[f.key] = cfg[f.key] ?? (f.type === "chain-addresses" ? [] : f.type === "checkbox" ? false : "");
      }
      out.push({ ...def, enabled, mode, values, secretsSet, complete: await this.isComplete(def, cfg) });
    }
    return out;
  }

  async saveGateway(slug: string, input: { enabled?: boolean; mode?: string; values?: Cfg; clearSecrets?: string[] }, by: string) {
    if (!isGatewaySlug(slug)) throw new NotFoundException("Unknown gateway");
    const def = GATEWAY_BY_SLUG.get(slug) as GatewayDef;
    const current = await this.readConfig(slug);
    const next: Cfg = { ...current.cfg };
    for (const f of def.fields) {
      if (f.type === "chain-addresses") {
        if (input.values && f.key in input.values) next[f.key] = this.cleanAddresses(input.values[f.key]);
        continue;
      }
      if (f.secret) {
        if (input.clearSecrets?.includes(f.key)) delete next[f.key];
        const v = input.values?.[f.key];
        if (typeof v === "string" && v.trim() !== "") next[f.key] = v.trim();
        continue;
      }
      if (input.values && f.key in input.values) {
        const v = input.values[f.key];
        next[f.key] = f.type === "checkbox" ? Boolean(v) : trimStr(v).slice(0, 2000);
      }
    }
    for (const k of ["fee", "feeFixed", "autoApproveMaxAmount"]) {
      const v = trimStr(next[k]);
      if (v !== "" && !/^\d+(\.\d+)?$/.test(v)) throw new BadRequestException(`${k} must be a number`);
    }
    const mode = input.mode === "test" ? "test" : input.mode === "live" ? "live" : current.mode;
    const enabled = input.enabled ?? current.enabled;
    if (enabled && !(await this.isComplete(def, next))) {
      throw new BadRequestException(`${def.name} cannot be turned on yet: fill in the required fields first.`);
    }
    await this.store.saveGateway({
      slug,
      enabled,
      mode,
      sortOrder: GATEWAY_DEFS.findIndex((g) => g.slug === slug),
      configEnc: encryptJson(next, this.pepper),
      updatedBy: by,
    });
  }

  private cleanAddresses(value: unknown): ChainAddress[] {
    if (!Array.isArray(value)) return [];
    const networks = new Set(CHAIN_NETWORKS.map((n) => n.code));
    return value.slice(0, 30).map((raw) => {
      const a = raw as Partial<ChainAddress>;
      const coin = trimStr(a.coin).toUpperCase();
      const network = trimStr(a.network).toUpperCase();
      const address = trimStr(a.address);
      if (!(CHAIN_COINS as readonly string[]).includes(coin)) throw new BadRequestException(`Unsupported coin "${coin}"`);
      if (!networks.has(network)) throw new BadRequestException(`Unsupported network "${network}"`);
      if (!/^[A-Za-z0-9_-]{20,120}$/.test(address)) throw new BadRequestException("A deposit address looks wrong");
      return { coin, network, address };
    });
  }

  // ───────────────────────── bKash numbers (admin) ─────────────────────────

  listNumbers() {
    return this.store.listNumbers();
  }

  async addNumber(raw: string, label?: string) {
    const number = raw.replace(/[\s-]/g, "").replace(/^\+?880/, "0");
    if (!/^01[3-9]\d{8}$/.test(number)) throw new BadRequestException("Enter a Bangladesh mobile number like 017XXXXXXXX");
    try {
      return await this.store.addNumber(number, label?.trim() || null);
    } catch (e) {
      if (e instanceof DuplicateTransactionError || (e as { code?: string }).code === "23505") throw new ConflictException("That number is already in the list");
      throw e;
    }
  }

  updateNumber(id: string, patch: { enabled?: boolean; label?: string | null }) {
    return this.store.updateNumber(id, patch);
  }

  removeNumber(id: string) {
    return this.store.removeNumber(id);
  }

  // ───────────────────────── orders ─────────────────────────

  private async pricing(planKey: "lifetime" | "annual") {
    const p = (await this.site.get()).content.pricing;
    const plan = planKey === "lifetime" ? p.lifetime : p.annual;
    return { usdMinor: Math.round(plan.usd * 100), bdt: Math.round(plan.bdt) };
  }

  async createOrder(input: { planKey: string; email: string; name?: string }): Promise<OrderRecord> {
    if (input.planKey !== "lifetime" && input.planKey !== "annual") throw new BadRequestException("Choose the Lifetime or the 1-Year plan");
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) throw new BadRequestException("Enter a valid email address");
    const price = await this.pricing(input.planKey);
    if (price.usdMinor <= 0) throw new BadRequestException("This plan is not for sale right now");
    const now = Date.now();
    const order: OrderRecord = {
      id: crypto.randomUUID(),
      token: crypto.randomBytes(24).toString("base64url"),
      email,
      customerName: input.name?.trim().slice(0, 150) || null,
      planKey: input.planKey,
      planId: PLAN_IDS[input.planKey],
      baseUsdMinor: price.usdMinor,
      baseBdt: price.bdt,
      status: "pending",
      gatewaySlug: null,
      gatewayRef: null,
      currency: null,
      amountDueMinor: null,
      chainCoin: null,
      chainNetwork: null,
      chainAddress: null,
      licenseId: null,
      keyEnc: null,
      meta: {},
      createdAt: new Date(now).toISOString(),
      paidAt: null,
      expiresAt: new Date(now + ORDER_LIFETIME_MS).toISOString(),
    };
    await this.store.insertOrder(order);
    return order;
  }

  private async requireOrder(token: string): Promise<OrderRecord> {
    const o = token.length >= 16 && token.length <= 64 ? await this.store.getOrderByToken(token) : null;
    if (!o) throw new NotFoundException("Order not found");
    return o;
  }

  private shortCode(o: OrderRecord): string {
    return o.id.replace(/-/g, "").slice(0, 8).toUpperCase();
  }

  private baseFor(o: OrderRecord, currency: Currency): number {
    return currency === "BDT" ? o.baseBdt : o.baseUsdMinor;
  }

  async methods(token: string): Promise<{ order: OrderRecord; methods: MethodView[] }> {
    const order = await this.requireOrder(token);
    const methods: MethodView[] = [];
    for (const def of GATEWAY_DEFS) {
      const { enabled, cfg } = await this.readConfig(def.slug);
      if (!enabled || !(await this.isComplete(def, cfg))) continue;
      if (def.currency === "BDT" && order.baseBdt <= 0) continue;
      const amountMinor = amountWithFees(this.baseFor(order, def.currency), cfg, def.currency);
      const view: MethodView = {
        slug: def.slug,
        name: def.name,
        description: def.description,
        currency: def.currency,
        flow: def.flow,
        amountMinor,
        amountText: formatMoney(amountMinor, def.currency),
      };
      if (def.slug === "binance_chain") {
        view.chains = this.chainAddresses(cfg).map((a) => ({
          coin: a.coin,
          network: a.network,
          networkLabel: CHAIN_NETWORKS.find((n) => n.code === a.network)?.label ?? a.network,
        }));
      }
      methods.push(view);
    }
    return { order, methods };
  }

  /** What the customer's order page shows. The license key appears only after payment. */
  async publicOrder(token: string) {
    const o = await this.requireOrder(token);
    const subs = await this.store.submissionsForOrder(o.id);
    const key = o.status === "paid" && o.keyEnc ? (decryptJson<{ key: string }>(o.keyEnc, this.pepper)?.key ?? null) : null;
    return {
      token: o.token,
      status: o.status,
      email: o.email,
      plan: { key: o.planKey, name: PLAN_NAMES[o.planKey] },
      gateway: o.gatewaySlug,
      amountText: o.amountDueMinor != null && o.currency ? formatMoney(o.amountDueMinor, o.currency) : null,
      reference: this.shortCode(o),
      expiresAt: o.expiresAt,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      licenseKey: key,
      submission: subs[0] ? { status: subs[0].status, trxId: subs[0].trxId, note: subs[0].status === "rejected" ? subs[0].adminNote : null } : null,
    };
  }

  // ───────────────────────── starting a payment ─────────────────────────

  async start(token: string, slug: string, opts: { coin?: string; network?: string } = {}): Promise<StartResult> {
    const order = await this.requireOrder(token);
    if (order.status !== "pending") throw new ConflictException("This order is no longer waiting for payment");
    if (new Date(order.expiresAt) < new Date()) throw new ConflictException("This order has expired. Start a new one.");
    if (!isGatewaySlug(slug)) throw new NotFoundException("Unknown payment method");
    const def = GATEWAY_BY_SLUG.get(slug) as GatewayDef;
    const { enabled, mode, cfg } = await this.readConfig(slug);
    if (!enabled || !(await this.isComplete(def, cfg))) throw new BadRequestException("This payment method is not available");

    const amount = amountWithFees(this.baseFor(order, def.currency), cfg, def.currency);
    const text = formatMoney(amount, def.currency);
    const back = `${this.siteUrl}/checkout?order=${order.token}`;
    const reference = this.shortCode(order);
    const stamp = { gatewaySlug: slug, currency: def.currency, amountDueMinor: amount } as const;

    switch (slug) {
      case "stripe": {
        const s = await stripeCreateSession(this.http, trimStr(cfg.secretKey), {
          orderId: order.id,
          orderToken: order.token,
          amountMinor: amount,
          productName: PLAN_NAMES[order.planKey],
          email: order.email,
          successUrl: back,
          cancelUrl: back,
        });
        await this.store.updateOrder(order.id, { ...stamp, gatewayRef: s.id });
        return { type: "redirect", url: s.url };
      }
      case "cryptomus": {
        const inv = await cryptomusCreateInvoice(
          this.http,
          { merchantUuid: trimStr(cfg.merchantUuid), apiKey: trimStr(cfg.apiKey) },
          { orderId: order.id, amountUsd: (amount / 100).toFixed(2), callbackUrl: `${this.apiUrl}/v1/pay/webhook/cryptomus`, returnUrl: back, successUrl: back }
        );
        await this.store.updateOrder(order.id, { ...stamp, gatewayRef: inv.uuid });
        return { type: "redirect", url: inv.url };
      }
      case "bkash": {
        const p = await bkashCreatePayment(
          this.http,
          this.bkashCreds(cfg, mode),
          { orderId: order.id, amountTaka: amount, callbackUrl: `${this.apiUrl}/v1/pay/callback/bkash?o=${order.token}` }
        );
        await this.store.updateOrder(order.id, { ...stamp, gatewayRef: p.paymentId });
        return { type: "redirect", url: p.url };
      }
      case "bkash_personal": {
        const numbers = (await this.store.listNumbers()).filter((n) => n.enabled);
        // Spread customers over the numbers: the one with the fewest open orders first.
        const open = await this.store.listOrders("pending", 500);
        const load = (n: string) => open.filter((o) => o.gatewaySlug === "bkash_personal" && o.meta.number === n).length;
        const pick = [...numbers].sort((a, b) => load(a.number) - load(b.number))[0];
        await this.store.updateOrder(order.id, { ...stamp, meta: { ...order.meta, number: pick.number } });
        return { type: "manual", kind: "bkash_personal", number: pick.number, amountText: text, reference, instructions: trimStr(cfg.instructions) };
      }
      case "binance": {
        await this.store.updateOrder(order.id, stamp);
        return {
          type: "manual",
          kind: "binance",
          name: trimStr(cfg.binanceName),
          uid: trimStr(cfg.uid),
          qr: cfg.hideQr ? "" : trimStr(cfg.qrimage),
          amountText: text,
          reference,
          instructions: trimStr(cfg.instructions),
          canAutoVerify: Boolean(trimStr(cfg.apiKey) && trimStr(cfg.apiSecret)),
        };
      }
      case "binance_chain": {
        const addrs = this.chainAddresses(cfg);
        const chosen = addrs.find((a) => a.coin === opts.coin && a.network === opts.network) ?? addrs[0];
        const unique = await this.uniqueChainAmount(amount, chosen);
        await this.store.updateOrder(order.id, {
          gatewaySlug: slug,
          currency: "USD",
          amountDueMinor: unique,
          chainCoin: chosen.coin,
          chainNetwork: chosen.network,
          chainAddress: chosen.address,
        });
        return {
          type: "auto",
          coin: chosen.coin,
          network: chosen.network,
          networkLabel: CHAIN_NETWORKS.find((n) => n.code === chosen.network)?.label ?? chosen.network,
          address: chosen.address,
          amountText: (unique / 100).toFixed(2),
        };
      }
    }
  }

  /** Each open on-chain order gets its own cents so a deposit can be matched to exactly one order. */
  private async uniqueChainAmount(baseCents: number, a: ChainAddress): Promise<number> {
    const taken = new Set(
      (await this.store.pendingChainOrders())
        .filter((o) => o.chainAddress === a.address && o.chainNetwork === a.network && o.chainCoin === a.coin)
        .map((o) => o.amountDueMinor)
    );
    for (let k = 0; k <= 99; k++) if (!taken.has(baseCents + k)) return baseCents + k;
    throw new ConflictException("Too many open crypto orders right now. Try again in a few minutes.");
  }

  private bkashCreds(cfg: Cfg, mode: string): BkashCreds {
    return { username: trimStr(cfg.username), password: trimStr(cfg.password), appKey: trimStr(cfg.appKey), appSecret: trimStr(cfg.appSecret), mode };
  }

  // ───────────────────────── paying: the shared finish line ─────────────────────────

  /** Marks the order paid and issues exactly one license. Safe to call twice. */
  async markPaid(orderId: string, gateway: string, ref: string | null, by = "system"): Promise<OrderRecord> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (!(await this.store.claimPaid(orderId, gateway, ref))) return (await this.store.getOrder(orderId)) as OrderRecord;
    try {
      const customer = await this.licenses.findOrCreateCustomer(order.email, order.customerName ?? undefined);
      const made = await this.licenses.createLicense(customer.id, order.planId, {
        source: gateway,
        note: `Order ${this.shortCode(order)}${ref ? ` (${ref})` : ""}`,
        issuedBy: by,
      });
      await this.store.updateOrder(orderId, { licenseId: made.licenseId, keyEnc: encryptJson({ key: made.key }, this.pepper) });
    } catch (e) {
      // The money arrived but the key could not be made: keep the order paid and let an admin retry.
      this.logger.error(`license for order ${orderId} failed: ${String(e)}`);
      await this.store.updateOrder(orderId, { meta: { ...order.meta, licenseError: String(e).slice(0, 300) } });
    }
    return (await this.store.getOrder(orderId)) as OrderRecord;
  }

  /** Admin: make the license for a paid order whose key could not be created. */
  async retryLicense(orderId: string, by: string): Promise<OrderRecord> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "paid") throw new BadRequestException("Only a paid order can get a license");
    if (order.licenseId) return order;
    const customer = await this.licenses.findOrCreateCustomer(order.email, order.customerName ?? undefined);
    const made = await this.licenses.createLicense(customer.id, order.planId, {
      source: order.gatewaySlug ?? "manual",
      note: `Order ${this.shortCode(order)}${order.gatewayRef ? ` (${order.gatewayRef})` : ""}`,
      issuedBy: by,
    });
    await this.store.updateOrder(orderId, { licenseId: made.licenseId, keyEnc: encryptJson({ key: made.key }, this.pepper) });
    return (await this.store.getOrder(orderId)) as OrderRecord;
  }

  // ───────────────────────── manual payments (customer reports a transaction) ─────────────────────────

  async submitManual(token: string, input: { trxId: string; sender?: string }): Promise<{ status: "pending" | "approved"; message: string }> {
    const order = await this.requireOrder(token);
    if (order.status !== "pending") throw new ConflictException("This order is no longer waiting for payment");
    const slug = order.gatewaySlug;
    if (slug !== "bkash_personal" && slug !== "binance") throw new BadRequestException("Choose a payment method first");

    let trx = input.trxId.trim();
    if (slug === "bkash_personal") {
      trx = trx.toUpperCase();
      if (!/^[A-Z0-9]{8,12}$/.test(trx)) throw new BadRequestException("The bKash TrxID is 8 to 12 letters and digits, like 9AB1CD2EFG");
    } else if (!/^[A-Za-z0-9_.:-]{6,128}$/.test(trx)) {
      throw new BadRequestException("That transaction id does not look right");
    }
    const sub: SubmissionRecord = {
      id: crypto.randomUUID(),
      orderId: order.id,
      gatewaySlug: slug,
      trxId: trx,
      sender: input.sender?.trim().slice(0, 80) || null,
      status: "pending",
      verifiedBy: null,
      adminNote: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
    };
    try {
      await this.store.insertSubmission(sub);
    } catch (e) {
      if (e instanceof DuplicateTransactionError) throw new ConflictException("That transaction id was already used for a payment.");
      throw e;
    }

    // Try to confirm it right away; otherwise it waits for an admin.
    if (slug === "bkash_personal") {
      const sms = await this.store.findUnmatchedSms(trx);
      if (sms && (sms.amountTaka ?? 0) + 0.005 >= (order.amountDueMinor ?? Number.MAX_SAFE_INTEGER)) {
        await this.store.markSmsMatched(sms.id, order.id);
        await this.approveSubmission(sub.id, "sms-forwarder", "Matched a received bKash SMS", "sms");
        return { status: "approved", message: "Payment confirmed." };
      }
    } else {
      const verified = await this.tryBinanceVerify(order, trx);
      if (verified === "auto") {
        await this.approveSubmission(sub.id, "binance-api", "Found in Binance deposit history", "api");
        return { status: "approved", message: "Payment confirmed." };
      }
      if (verified === "found") await this.store.decideSubmissionNote(sub.id, "Found in Binance deposit history; waiting for approval.");
    }
    return { status: "pending", message: "Thanks. We will confirm your payment shortly; this page updates by itself." };
  }

  private async tryBinanceVerify(order: OrderRecord, txId: string): Promise<"auto" | "found" | "no"> {
    const { cfg } = await this.readConfig("binance");
    if (!trimStr(cfg.apiKey) || !trimStr(cfg.apiSecret)) return "no";
    try {
      const now = Date.now();
      const deposits = await binanceDeposits(this.http, { apiKey: trimStr(cfg.apiKey), apiSecret: trimStr(cfg.apiSecret) }, "USDT", now - 7 * 24 * 3600_000, now);
      const hit = findDepositByTxId(deposits, txId, ["USDT"], (order.amountDueMinor ?? 0) / 100);
      if (!hit) return "no";
      const max = Number.parseFloat(trimStr(cfg.autoApproveMaxAmount) || "0");
      // Auto-approval is limited on purpose: a transaction id is public, so a small cap keeps a copied one cheap.
      return max > 0 && (order.amountDueMinor ?? 0) / 100 <= max ? "auto" : "found";
    } catch (e) {
      this.logger.warn(`Binance verification failed: ${String(e)}`);
      return "no";
    }
  }

  async approveSubmission(id: string, by: string, note?: string, verifiedBy?: string): Promise<OrderRecord> {
    const sub = await this.store.getSubmission(id);
    if (!sub) throw new NotFoundException("Payment report not found");
    if (!(await this.store.decideSubmission(id, "approved", by, note, verifiedBy ?? "admin"))) throw new ConflictException("This report was already decided");
    return this.markPaid(sub.orderId, sub.gatewaySlug, sub.trxId, by);
  }

  async rejectSubmission(id: string, by: string, note?: string): Promise<void> {
    const sub = await this.store.getSubmission(id);
    if (!sub) throw new NotFoundException("Payment report not found");
    if (!(await this.store.decideSubmission(id, "rejected", by, note?.slice(0, 300)))) throw new ConflictException("This report was already decided");
  }

  // ───────────────────────── webhooks and callbacks ─────────────────────────

  async stripeWebhook(raw: string, signature: string | undefined): Promise<{ received: true }> {
    const { cfg } = await this.readConfig("stripe");
    if (!stripeVerify(raw, signature, trimStr(cfg.webhookSecret), Math.floor(Date.now() / 1000))) throw new UnauthorizedException("Invalid signature");
    const event = JSON.parse(raw) as { type?: string; data?: { object?: { client_reference_id?: string; payment_status?: string; amount_total?: number; currency?: string; id?: string } } };
    const obj = event.data?.object;
    if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && obj?.payment_status === "paid" && obj.client_reference_id) {
      const order = await this.store.getOrder(obj.client_reference_id);
      if (order && order.gatewaySlug === "stripe" && obj.currency === "usd" && obj.amount_total === order.amountDueMinor) {
        await this.markPaid(order.id, "stripe", obj.id ?? null);
      } else {
        this.logger.warn(`Stripe payment for ${obj.client_reference_id} did not match its order (amount/currency/gateway)`);
      }
    }
    return { received: true };
  }

  async cryptomusWebhook(payload: Record<string, unknown>): Promise<{ received: true }> {
    const { cfg } = await this.readConfig("cryptomus");
    if (!cryptomusVerify(payload, trimStr(cfg.apiKey))) throw new UnauthorizedException("Invalid signature");
    const status = String(payload.status ?? payload.payment_status ?? "");
    const orderId = String(payload.order_id ?? "");
    if ((status === "paid" || status === "paid_over") && orderId) {
      const order = await this.store.getOrder(orderId).catch(() => null);
      if (order && order.gatewaySlug === "cryptomus") await this.markPaid(order.id, "cryptomus", String(payload.uuid ?? ""));
    }
    return { received: true };
  }

  /** bKash sends the customer back here after they approve (or cancel); returns where to send them next. */
  async bkashCallback(token: string, paymentId: string, status: string): Promise<string> {
    const back = `${this.siteUrl}/checkout?order=${encodeURIComponent(token)}`;
    const order = await this.store.getOrderByToken(token);
    if (!order || order.gatewaySlug !== "bkash" || order.gatewayRef !== paymentId) return back;
    if (status !== "success") return `${back}&result=cancelled`;
    const { cfg, mode } = await this.readConfig("bkash");
    try {
      const r = await bkashExecute(this.http, this.bkashCreds(cfg, mode), paymentId);
      if (r.completed && r.invoice === order.id && (r.amount ?? 0) + 0.005 >= (order.amountDueMinor ?? Number.MAX_SAFE_INTEGER)) {
        await this.markPaid(order.id, "bkash", r.trxId ?? paymentId);
        return back;
      }
      this.logger.warn(`bKash execute for ${order.id} not completed or mismatched: ${r.message ?? "no message"}`);
    } catch (e) {
      this.logger.warn(`bKash execute failed: ${String(e)}`);
    }
    return `${back}&result=failed`;
  }

  /** A phone app forwards each received bKash SMS here. Matching reports are approved automatically. */
  async bkashSms(secret: string | undefined, text: string): Promise<{ matched: boolean }> {
    const { cfg } = await this.readConfig("bkash_personal");
    const expected = trimStr(cfg.smsSecret);
    if (!expected || !secret || !safeEqual(secret, expected)) throw new UnauthorizedException("Invalid secret");
    const sms = parseBkashSms(text.slice(0, 1000));
    if (!sms) {
      await this.store.addSms({ trxId: null, amountTaka: null, sender: null, matchedOrder: null, note: "not a bKash receive message" });
      return { matched: false };
    }
    const event = await this.store.addSms({ trxId: sms.trxId, amountTaka: sms.amountTaka, sender: sms.sender, matchedOrder: null, note: null });
    const pending = (await this.store.listSubmissions("pending")).find((s) => s.gatewaySlug === "bkash_personal" && s.trxId.toUpperCase() === sms.trxId);
    if (!pending) return { matched: false };
    const order = await this.store.getOrder(pending.orderId);
    if (order && order.status === "pending" && sms.amountTaka + 0.005 >= (order.amountDueMinor ?? Number.MAX_SAFE_INTEGER)) {
      await this.store.markSmsMatched(event.id, order.id);
      await this.approveSubmission(pending.id, "sms-forwarder", "Matched a received bKash SMS", "sms");
      return { matched: true };
    }
    return { matched: false };
  }

  // ───────────────────────── background work ─────────────────────────

  /** Expires old orders and matches on-chain deposits. Runs every minute. */
  async tick(): Promise<void> {
    await this.store.expireOldOrders(new Date());
    await this.pollChain();
  }

  async pollChain(now = Date.now()): Promise<number> {
    const orders = await this.store.pendingChainOrders();
    if (orders.length === 0) return 0;
    const { cfg: chainCfg } = await this.readConfig("binance_chain");
    const { cfg: payCfg } = await this.readConfig("binance");
    const apiKey = trimStr(chainCfg.apiKey) || trimStr(payCfg.apiKey);
    const apiSecret = trimStr(chainCfg.apiSecret) || trimStr(payCfg.apiSecret);
    if (!apiKey || !apiSecret) return 0;
    const used = await this.store.usedReferences("binance_chain");
    let matched = 0;
    for (const coin of new Set(orders.map((o) => o.chainCoin as string))) {
      const mine = orders.filter((o) => o.chainCoin === coin);
      const since = Math.min(...mine.map((o) => new Date(o.createdAt).getTime())) - 5 * 60_000;
      const deposits = await binanceDeposits(this.http, { apiKey, apiSecret }, coin, since, now);
      for (const o of mine) {
        const hit = findDepositByAmount(
          deposits,
          { address: o.chainAddress as string, network: o.chainNetwork as string, coin, amount: (o.amountDueMinor as number) / 100 },
          used
        );
        if (hit) {
          used.add(hit.txId.toLowerCase());
          await this.markPaid(o.id, "binance_chain", hit.txId);
          matched++;
        }
      }
    }
    return matched;
  }

  // ───────────────────────── admin: orders ─────────────────────────

  async adminOrders(status?: string) {
    const [orders, subs] = await Promise.all([this.store.listOrders(status), this.store.listSubmissions()]);
    return orders.map((o) => ({
      id: o.id,
      reference: this.shortCode(o),
      email: o.email,
      customerName: o.customerName,
      plan: PLAN_NAMES[o.planKey],
      status: o.status,
      gateway: o.gatewaySlug,
      amountText: o.amountDueMinor != null && o.currency ? formatMoney(o.amountDueMinor, o.currency) : null,
      gatewayRef: o.gatewayRef,
      licenseId: o.licenseId,
      licenseError: (o.meta.licenseError as string | undefined) ?? null,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      pendingReports: subs.filter((s) => s.orderId === o.id && s.status === "pending").length,
    }));
  }

  async adminSubmissions(status?: string) {
    const subs = await this.store.listSubmissions(status);
    const out = [];
    for (const s of subs) {
      const o = await this.store.getOrder(s.orderId);
      out.push({
        ...s,
        orderReference: o ? this.shortCode(o) : "",
        email: o?.email ?? "",
        plan: o ? PLAN_NAMES[o.planKey] : "",
        amountText: o?.amountDueMinor != null && o.currency ? formatMoney(o.amountDueMinor, o.currency) : null,
        orderStatus: o?.status ?? "",
        number: (o?.meta.number as string | undefined) ?? null,
      });
    }
    return out;
  }

  /** Admin: the customer paid in a way this system cannot see (cash, bank transfer, ...). */
  async markPaidByAdmin(orderId: string, by: string, note?: string): Promise<OrderRecord> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "pending" && order.status !== "expired") throw new ConflictException("This order is not waiting for payment");
    if (order.status === "expired") await this.store.updateOrder(orderId, { status: "pending" });
    return this.markPaid(orderId, order.gatewaySlug ?? "manual", note ? `admin: ${note.slice(0, 80)}` : "admin", by);
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "pending") throw new ConflictException("Only an unpaid order can be cancelled");
    await this.store.updateOrder(orderId, { status: "cancelled" });
  }

  /** Admin: money was refunded. The license stops working. */
  async refundOrder(orderId: string): Promise<void> {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new NotFoundException("Order not found");
    if (order.status !== "paid") throw new ConflictException("Only a paid order can be refunded");
    if (order.licenseId) await this.licenses.revokeLicense(order.licenseId);
    await this.store.updateOrder(orderId, { status: "refunded" });
  }
}

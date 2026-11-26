import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicensesService } from "../src/licenses/licenses.service";
import {
  cryptomusSign,
  cryptomusVerify,
  parseBkashSms,
  stripeVerify,
  type HttpFn,
} from "../src/payments/clients";
import { amountWithFees, formatMoney } from "../src/payments/fees";
import { decryptJson, encryptJson } from "../src/payments/payment-crypto";
import { PaymentsService } from "../src/payments/payments.service";
import { PaymentsStore } from "../src/payments/payments.store";
import { SiteContentService } from "../src/site/site-content.service";

// ─────────── helpers ───────────
const config = new AppConfigService();
const es256 = new Es256Service(config);
es256.onModuleInit();

interface Call {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function makeFake(handler: (c: Call) => unknown) {
  const calls: Call[] = [];
  const http: HttpFn = async (url, init) => {
    const call = { url, ...init };
    calls.push(call);
    const out = handler(call);
    return { status: 200, text: async () => JSON.stringify(out) };
  };
  return { http, calls };
}

function setup(handler: (c: Call) => unknown = () => ({})) {
  process.env.SITE_CONTENT_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mjdm-pay-")), "site.json");
  const db = new DatabaseService(config);
  const licenses = new LicensesService(db, config, es256);
  const site = new SiteContentService();
  const store = new PaymentsStore();
  const fake = makeFake(handler);
  const svc = new PaymentsService(store, licenses, site, config, fake.http);
  return { svc, licenses, store, fake };
}

const pepper = config.get("SERVER_PEPPER");

async function enable(svc: PaymentsService, slug: string, values: Record<string, unknown>) {
  await svc.saveGateway(slug, { enabled: true, values }, "boss@example.test");
}

const BKASH_TRX = "9AB1CD2EFG";

describe("money and secrets", () => {
  it("adds the percentage and the fixed fee on top of the price", () => {
    expect(amountWithFees(2495, { fee: "2.9", feeFixed: "0.30" }, "USD")).toBe(Math.ceil(2495 * 1.029 + 30));
    expect(amountWithFees(999, { fee: "1.85" }, "BDT")).toBe(Math.ceil(999 * 1.0185));
    expect(amountWithFees(999, {}, "BDT")).toBe(999);
    expect(amountWithFees(999, { fee: "abc", feeFixed: "-5" }, "BDT")).toBe(999);
    expect(formatMoney(2495, "USD")).toBe("$24.95");
    expect(formatMoney(999, "BDT")).toBe("৳999");
  });

  it("encrypts credentials and cannot read them with another secret", () => {
    const blob = encryptJson({ secretKey: "sk_live_abc" }, pepper);
    expect(blob).not.toContain("sk_live_abc");
    expect(decryptJson<{ secretKey: string }>(blob, pepper)?.secretKey).toBe("sk_live_abc");
    expect(decryptJson(blob, "another-pepper-another-pepper-another!")).toBeNull();
    expect(decryptJson(blob.slice(0, -3) + "AAA", pepper)).toBeNull();
  });
});

describe("gateway signatures", () => {
  it("Stripe: accepts a good signature, rejects tampering, wrong secret and old timestamps", () => {
    const raw = '{"id":"evt_1","type":"checkout.session.completed"}';
    const t = 1_800_000_000;
    const sig = crypto.createHmac("sha256", "whsec_x").update(`${t}.${raw}`).digest("hex");
    expect(stripeVerify(raw, `t=${t},v1=${sig}`, "whsec_x", t + 10)).toBe(true);
    expect(stripeVerify(raw + " ", `t=${t},v1=${sig}`, "whsec_x", t + 10)).toBe(false);
    expect(stripeVerify(raw, `t=${t},v1=${sig}`, "whsec_other", t + 10)).toBe(false);
    expect(stripeVerify(raw, `t=${t},v1=${sig}`, "whsec_x", t + 3600)).toBe(false);
    expect(stripeVerify(raw, undefined, "whsec_x", t)).toBe(false);
    expect(stripeVerify(raw, `t=${t},v1=${sig}`, "", t)).toBe(false);
  });

  it("Cryptomus: verifies the callback with and without escaped slashes", () => {
    const body = { type: "payment", order_id: "o1", status: "paid", url_callback: "https://a.example/x" };
    const plain = JSON.stringify(body);
    expect(cryptomusVerify({ ...body, sign: cryptomusSign(plain, "key") }, "key")).toBe(true);
    expect(cryptomusVerify({ ...body, sign: cryptomusSign(plain.replace(/\//g, "\\/"), "key") }, "key")).toBe(true);
    expect(cryptomusVerify({ ...body, status: "fail", sign: cryptomusSign(plain, "key") }, "key")).toBe(false);
    expect(cryptomusVerify({ ...body, sign: cryptomusSign(plain, "key") }, "wrong")).toBe(false);
    expect(cryptomusVerify(body, "key")).toBe(false);
  });

  it("bKash SMS: reads the amount, sender and TrxID", () => {
    const sms = parseBkashSms("You have received Tk 1,249.00 from 01712345678. Fee Tk 0.00. Balance Tk 5,000.00. TrxID 9AB1CD2EFG at 26/11/2026 14:30");
    expect(sms).toEqual({ amountTaka: 1249, sender: "01712345678", trxId: "9AB1CD2EFG" });
    expect(parseBkashSms("Your OTP is 123456")).toBeNull();
  });
});

describe("admin gateway settings", () => {
  it("never returns secrets, keeps them when the field is left empty, and refuses to turn on an incomplete gateway", async () => {
    const { svc } = setup();
    await expect(svc.saveGateway("stripe", { enabled: true, values: { secretKey: "sk_live_1" } }, "a")).rejects.toThrow(/fill in/);
    await svc.saveGateway("stripe", { enabled: true, values: { secretKey: "sk_live_1", webhookSecret: "whsec_1", fee: "2.9" } }, "a");
    const g = (await svc.adminGateways()).find((x) => x.slug === "stripe")!;
    expect(g.enabled).toBe(true);
    expect(g.complete).toBe(true);
    expect(g.secretsSet.secretKey).toBe(true);
    expect(JSON.stringify(g)).not.toContain("sk_live_1");
    expect(g.values.fee).toBe("2.9");

    await svc.saveGateway("stripe", { values: { secretKey: "", fee: "3" } }, "a"); // empty secret = keep
    expect((await svc.adminGateways()).find((x) => x.slug === "stripe")!.secretsSet.secretKey).toBe(true);
    await svc.saveGateway("stripe", { enabled: false, clearSecrets: ["secretKey"] }, "a");
    expect((await svc.adminGateways()).find((x) => x.slug === "stripe")!.secretsSet.secretKey).toBe(false);
    await expect(svc.saveGateway("nope", {}, "a")).rejects.toThrow();
    await expect(svc.saveGateway("stripe", { values: { fee: "ten" } }, "a")).rejects.toThrow(/number/);
  });

  it("validates bKash numbers and on-chain addresses", async () => {
    const { svc } = setup();
    await expect(svc.addNumber("12345")).rejects.toThrow();
    expect((await svc.addNumber("+8801712345678", "main")).number).toBe("01712345678");
    await expect(svc.addNumber("01712345678")).rejects.toThrow(/already/);
    await expect(svc.saveGateway("binance_chain", { values: { addresses: [{ coin: "DOGE", network: "BSC", address: "x".repeat(30) }] } }, "a")).rejects.toThrow(/coin/);
    await expect(svc.saveGateway("binance_chain", { values: { addresses: [{ coin: "USDT", network: "NOPE", address: "x".repeat(30) }] } }, "a")).rejects.toThrow(/network/);
    await expect(svc.saveGateway("binance_chain", { values: { addresses: [{ coin: "USDT", network: "BSC", address: "short" }] } }, "a")).rejects.toThrow(/address/);
  });
});

describe("orders and prices", () => {
  it("prices come from the site settings and each gateway shows its own amount with fees", async () => {
    const { svc, store } = setup();
    await enable(svc, "stripe", { secretKey: "sk", webhookSecret: "wh", fee: "2.9", feeFixed: "0.30" });
    await svc.addNumber("01712345678");
    await enable(svc, "bkash_personal", { fee: "1.5" });
    const o = await svc.createOrder({ planKey: "lifetime", email: " Buyer@Example.test ", name: "B" });
    expect(o.email).toBe("buyer@example.test");
    expect(o.baseUsdMinor).toBe(2495);
    expect(o.baseBdt).toBe(999);
    const { methods } = await svc.methods(o.token);
    const stripe = methods.find((m) => m.slug === "stripe")!;
    const bkash = methods.find((m) => m.slug === "bkash_personal")!;
    expect(stripe.amountMinor).toBe(Math.ceil(2495 * 1.029 + 30));
    expect(bkash.amountMinor).toBe(Math.ceil(999 * 1.015));
    expect(bkash.currency).toBe("BDT");
    expect(methods.some((m) => m.slug === "cryptomus")).toBe(false); // not configured
    expect(await store.listOrders()).toHaveLength(1);
    await expect(svc.createOrder({ planKey: "weekly", email: "a@b.co" })).rejects.toThrow();
    await expect(svc.createOrder({ planKey: "annual", email: "not-an-email" })).rejects.toThrow();
  });

  it("the license key is hidden until the order is paid", async () => {
    const { svc } = setup();
    const o = await svc.createOrder({ planKey: "annual", email: "x@y.test" });
    expect((await svc.publicOrder(o.token)).licenseKey).toBeNull();
    await expect(svc.publicOrder("short")).rejects.toThrow();
  });
});

describe("bKash personal number (manual + SMS)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.svc.addNumber("01712345678");
    await enable(ctx.svc, "bkash_personal", { smsSecret: "sms-secret-1" });
  });

  it("customer pays, reports the TrxID, an admin approves, and the key appears once", async () => {
    const { svc } = ctx;
    const o = await svc.createOrder({ planKey: "lifetime", email: "buyer@example.test" });
    const start = await svc.start(o.token, "bkash_personal");
    expect(start).toMatchObject({ type: "manual", kind: "bkash_personal", number: "01712345678", amountText: "৳999" });

    await expect(svc.submitManual(o.token, { trxId: "bad" })).rejects.toThrow();
    const sub = await svc.submitManual(o.token, { trxId: BKASH_TRX.toLowerCase(), sender: "01911112222" });
    expect(sub.status).toBe("pending");
    expect((await svc.publicOrder(o.token)).licenseKey).toBeNull();

    // the same TrxID cannot pay for another order
    const o2 = await svc.createOrder({ planKey: "lifetime", email: "other@example.test" });
    await svc.start(o2.token, "bkash_personal");
    await expect(svc.submitManual(o2.token, { trxId: BKASH_TRX })).rejects.toThrow(/already used/);

    const [report] = await svc.adminSubmissions("pending");
    expect(report.trxId).toBe(BKASH_TRX);
    await svc.approveSubmission(report.id, "boss@example.test");
    const after = await svc.publicOrder(o.token);
    expect(after.status).toBe("paid");
    expect(after.licenseKey).toMatch(/^MJDM(-[0-9A-Z]{5}){4}$/);
    await expect(svc.approveSubmission(report.id, "boss")).rejects.toThrow(/already decided/);
  });

  it("an SMS that arrives first confirms the payment the moment the TrxID is reported", async () => {
    const { svc } = ctx;
    const o = await svc.createOrder({ planKey: "annual", email: "early@example.test" });
    await svc.start(o.token, "bkash_personal");
    const taka = 499;
    const r = await svc.bkashSms("sms-secret-1", `You have received Tk ${taka}.00 from 01911112222. TrxID ${BKASH_TRX} at 26/11/2026`);
    expect(r.matched).toBe(false); // nobody reported it yet
    const sub = await svc.submitManual(o.token, { trxId: BKASH_TRX });
    expect(sub.status).toBe("approved");
    expect((await svc.publicOrder(o.token)).status).toBe("paid");
  });

  it("an SMS that arrives after the report approves it; a short payment or wrong secret does not", async () => {
    const { svc } = ctx;
    const o = await svc.createOrder({ planKey: "lifetime", email: "late@example.test" });
    await svc.start(o.token, "bkash_personal");
    await svc.submitManual(o.token, { trxId: BKASH_TRX });
    await expect(svc.bkashSms("wrong", "x")).rejects.toThrow();
    expect((await svc.bkashSms("sms-secret-1", `You have received Tk 500.00 from 01911112222. TrxID ${BKASH_TRX}`)).matched).toBe(false);
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
    expect((await svc.bkashSms("sms-secret-1", `You have received Tk 999.00 from 01911112222. TrxID ${BKASH_TRX}`)).matched).toBe(true);
    expect((await svc.publicOrder(o.token)).status).toBe("paid");
  });

  it("rejecting a report leaves the order open so the customer can send the right TrxID", async () => {
    const { svc } = ctx;
    const o = await svc.createOrder({ planKey: "lifetime", email: "typo@example.test" });
    await svc.start(o.token, "bkash_personal");
    await svc.submitManual(o.token, { trxId: "AAAAAAAAAA" });
    const [report] = await svc.adminSubmissions("pending");
    await svc.rejectSubmission(report.id, "boss", "no such payment");
    const view = await svc.publicOrder(o.token);
    expect(view.status).toBe("pending");
    expect(view.submission?.status).toBe("rejected");
    expect((await svc.submitManual(o.token, { trxId: BKASH_TRX })).status).toBe("pending");
  });
});

describe("Stripe", () => {
  function stripeSetup() {
    const ctx = setup((c) => (c.url.includes("/checkout/sessions") ? { id: "cs_test_1", url: "https://checkout.stripe.test/pay/cs_test_1" } : {}));
    return ctx;
  }
  const signed = (raw: string, secret = "whsec_1") => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
  };
  const event = (orderId: string, amount: number, over: Record<string, unknown> = {}) =>
    JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_1", client_reference_id: orderId, payment_status: "paid", amount_total: amount, currency: "usd", ...over } } });

  it("starts a checkout session for the right amount and marks the order paid on a signed webhook, once", async () => {
    const { svc, fake, licenses } = stripeSetup();
    await enable(svc, "stripe", { secretKey: "sk_live_1", webhookSecret: "whsec_1", fee: "2.9", feeFixed: "0.30" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "card@example.test" });
    const start = await svc.start(o.token, "stripe");
    expect(start).toEqual({ type: "redirect", url: "https://checkout.stripe.test/pay/cs_test_1" });
    const call = fake.calls[0];
    expect(call.headers?.Authorization).toBe("Bearer sk_live_1");
    const due = Math.ceil(2495 * 1.029 + 30);
    expect(new URLSearchParams(call.body).get("line_items[0][price_data][unit_amount]")).toBe(String(due));
    expect(new URLSearchParams(call.body).get("client_reference_id")).toBe(o.id);

    const raw = event(o.id, due);
    await expect(svc.stripeWebhook(raw, "t=1,v1=bad")).rejects.toThrow(/signature/);
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
    await svc.stripeWebhook(raw, signed(raw));
    await svc.stripeWebhook(raw, signed(raw)); // Stripe retries: still one license
    const view = await svc.publicOrder(o.token);
    expect(view.status).toBe("paid");
    expect(view.licenseKey).toMatch(/^MJDM/);
    expect((await licenses.listLicensesForAdmin()).filter((l) => l.email === "card@example.test")).toHaveLength(1);
  });

  it("a payment for a different amount or an unpaid session does not unlock anything", async () => {
    const { svc } = stripeSetup();
    await enable(svc, "stripe", { secretKey: "sk", webhookSecret: "whsec_1" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "cheat@example.test" });
    await svc.start(o.token, "stripe");
    const cheap = event(o.id, 100);
    await svc.stripeWebhook(cheap, signed(cheap));
    const unpaid = event(o.id, 2495, { payment_status: "unpaid" });
    await svc.stripeWebhook(unpaid, signed(unpaid));
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
  });
});

describe("Cryptomus", () => {
  it("creates a signed invoice and accepts only a correctly signed paid callback", async () => {
    const { svc, fake } = setup((c) => (c.url.endsWith("/v1/payment") ? { state: 0, result: { url: "https://pay.cryptomus.test/x", uuid: "u-1" } } : {}));
    await enable(svc, "cryptomus", { merchantUuid: "m-1", apiKey: "ckey" });
    const o = await svc.createOrder({ planKey: "annual", email: "coin@example.test" });
    const start = await svc.start(o.token, "cryptomus");
    expect(start).toEqual({ type: "redirect", url: "https://pay.cryptomus.test/x" });
    expect(fake.calls[0].headers?.merchant).toBe("m-1");
    expect(fake.calls[0].headers?.sign).toBe(cryptomusSign(fake.calls[0].body as string, "ckey"));

    const payload = { order_id: o.id, status: "paid", uuid: "u-1" };
    await expect(svc.cryptomusWebhook({ ...payload, sign: "bad" })).rejects.toThrow();
    const unpaid = { order_id: o.id, status: "check", uuid: "u-1" };
    await svc.cryptomusWebhook({ ...unpaid, sign: cryptomusSign(JSON.stringify(unpaid), "ckey") });
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
    await svc.cryptomusWebhook({ ...payload, sign: cryptomusSign(JSON.stringify(payload), "ckey") });
    expect((await svc.publicOrder(o.token)).status).toBe("paid");
  });
});

describe("bKash merchant checkout", () => {
  function bk(executeAmount: string, trx = "TRX123ABC9") {
    return setup((c) => {
      if (c.url.endsWith("/token/grant")) return { id_token: "tok", statusCode: "0000" };
      if (c.url.endsWith("/create")) return { statusCode: "0000", paymentID: "P1", bkashURL: "https://pay.bka.sh/p1" };
      if (c.url.endsWith("/execute")) return { statusCode: "0000", transactionStatus: "Completed", trxID: trx, amount: executeAmount, merchantInvoiceNumber: JSON.parse(String(bkCalls.last)).merchantInvoiceNumber };
      return {};
    });
  }
  const bkCalls: { last?: string } = {};

  it("creates the payment, and a completed execute for the full amount marks it paid", async () => {
    const ctx = setup((c) => {
      if (c.url.endsWith("/token/grant")) return { id_token: "tok", statusCode: "0000" };
      if (c.url.endsWith("/create")) {
        bkCalls.last = c.body;
        return { statusCode: "0000", paymentID: "P1", bkashURL: "https://pay.bka.sh/p1" };
      }
      if (c.url.endsWith("/execute")) return { statusCode: "0000", transactionStatus: "Completed", trxID: "TRX123ABC9", amount: "999.00", merchantInvoiceNumber: JSON.parse(String(bkCalls.last)).merchantInvoiceNumber };
      return {};
    });
    const { svc } = ctx;
    await enable(svc, "bkash", { username: "u", password: "p", appKey: "k", appSecret: "s" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "bk@example.test" });
    const start = await svc.start(o.token, "bkash");
    expect(start).toEqual({ type: "redirect", url: "https://pay.bka.sh/p1" });
    const created = JSON.parse(String(bkCalls.last));
    expect(created).toMatchObject({ amount: "999.00", currency: "BDT", intent: "sale", merchantInvoiceNumber: o.id });

    expect(await svc.bkashCallback(o.token, "P1", "cancel")).toContain("result=cancelled");
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
    expect(await svc.bkashCallback(o.token, "WRONG", "success")).not.toContain("result=");
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
    await svc.bkashCallback(o.token, "P1", "success");
    expect((await svc.publicOrder(o.token)).status).toBe("paid");
  });

  it("a short payment is not accepted", async () => {
    const calls: { last?: string } = {};
    const { svc } = setup((c) => {
      if (c.url.endsWith("/token/grant")) return { id_token: "tok", statusCode: "0000" };
      if (c.url.endsWith("/create")) {
        calls.last = c.body;
        return { statusCode: "0000", paymentID: "P2", bkashURL: "https://pay.bka.sh/p2" };
      }
      return { statusCode: "0000", transactionStatus: "Completed", trxID: "T", amount: "100.00", merchantInvoiceNumber: JSON.parse(String(calls.last)).merchantInvoiceNumber };
    });
    await enable(svc, "bkash", { username: "u", password: "p", appKey: "k", appSecret: "s" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "short@example.test" });
    await svc.start(o.token, "bkash");
    expect(await svc.bkashCallback(o.token, "P2", "success")).toContain("result=failed");
    expect((await svc.publicOrder(o.token)).status).toBe("pending");
  });
});

describe("Binance", () => {
  const deposit = (over: Record<string, unknown>) => ({ amount: "30", coin: "USDT", network: "BSC", status: 1, address: "0xADDRESS000000000000000000000001", txId: "0xTX1ABC", insertTime: Date.now(), ...over });

  it("manual: a reported transaction found in deposit history is approved automatically only under the limit", async () => {
    const { svc } = setup((c) => (c.url.includes("deposit/hisrec") ? [deposit({ txId: "0xTX1ABC", amount: "30" })] : {}));
    await enable(svc, "binance", { uid: "123456", binanceName: "MJ", apiKey: "k", apiSecret: "s", autoApproveMaxAmount: "50" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "bn@example.test" });
    const start = await svc.start(o.token, "binance");
    expect(start).toMatchObject({ type: "manual", kind: "binance", uid: "123456", canAutoVerify: true });
    const r = await svc.submitManual(o.token, { trxId: "0xTX1ABC" });
    expect(r.status).toBe("approved");
    expect((await svc.publicOrder(o.token)).status).toBe("paid");
  });

  it("manual: above the limit it waits for an admin even when Binance confirms it; unknown ids wait too", async () => {
    const { svc } = setup((c) => (c.url.includes("deposit/hisrec") ? [deposit({ txId: "0xTX2ABC", amount: "30" })] : {}));
    await enable(svc, "binance", { uid: "1", apiKey: "k", apiSecret: "s", autoApproveMaxAmount: "10" });
    const o = await svc.createOrder({ planKey: "lifetime", email: "bn2@example.test" });
    await svc.start(o.token, "binance");
    expect((await svc.submitManual(o.token, { trxId: "0xTX2ABC" })).status).toBe("pending");
    const [report] = await svc.adminSubmissions("pending");
    expect(report.adminNote).toMatch(/Binance deposit history/);
    const o2 = await svc.createOrder({ planKey: "lifetime", email: "bn3@example.test" });
    await svc.start(o2.token, "binance");
    expect((await svc.submitManual(o2.token, { trxId: "0xNOTFOUND" })).status).toBe("pending");
  });

  it("auto-match: every open order gets its own amount, and a deposit pays exactly one of them, once", async () => {
    let deposits: unknown[] = [];
    const { svc } = setup((c) => (c.url.includes("deposit/hisrec") ? deposits : {}));
    const addr = "0xADDRESS000000000000000000000001";
    await enable(svc, "binance_chain", { addresses: [{ coin: "USDT", network: "BSC", address: addr }], apiKey: "k", apiSecret: "s" });
    const a = await svc.createOrder({ planKey: "lifetime", email: "a@example.test" });
    const b = await svc.createOrder({ planKey: "lifetime", email: "b@example.test" });
    const sa = await svc.start(a.token, "binance_chain");
    const sb = await svc.start(b.token, "binance_chain");
    if (sa.type !== "auto" || sb.type !== "auto") throw new Error("expected auto");
    expect(sa.amountText).toBe("24.95");
    expect(sb.amountText).toBe("24.96"); // different cents
    expect(sa.address).toBe(addr);

    deposits = [deposit({ amount: "24.96", txId: "0xB", address: addr })];
    expect(await svc.pollChain()).toBe(1);
    expect((await svc.publicOrder(b.token)).status).toBe("paid");
    expect((await svc.publicOrder(a.token)).status).toBe("pending");
    expect(await svc.pollChain()).toBe(0); // the same deposit does not pay again

    deposits = [deposit({ amount: "24.95", txId: "0xA", network: "ETH", address: addr })]; // wrong network
    expect(await svc.pollChain()).toBe(0);
    deposits = [deposit({ amount: "24.95", txId: "0xA", address: "0xOTHER00000000000000000000000000" })]; // wrong address
    expect(await svc.pollChain()).toBe(0);
    deposits = [deposit({ amount: "24.95", txId: "0xA", address: addr })];
    expect(await svc.pollChain()).toBe(1);
    expect((await svc.publicOrder(a.token)).status).toBe("paid");
  });
});

describe("admin order actions", () => {
  it("mark paid by hand issues one license; refund revokes it; cancel only works on unpaid orders", async () => {
    const { svc, licenses } = setup();
    const o = await svc.createOrder({ planKey: "lifetime", email: "cash@example.test" });
    await svc.markPaidByAdmin(o.id, "boss", "cash on 26 Nov");
    await expect(svc.markPaidByAdmin(o.id, "boss")).rejects.toThrow();
    const view = await svc.publicOrder(o.token);
    expect(view.status).toBe("paid");
    expect(view.licenseKey).toMatch(/^MJDM/);
    const rows = (await licenses.listLicensesForAdmin()).filter((l) => l.email === "cash@example.test");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("manual");

    await expect(svc.cancelOrder(o.id)).rejects.toThrow();
    await svc.refundOrder(o.id);
    expect((await licenses.listLicensesForAdmin()).find((l) => l.email === "cash@example.test")?.status).toBe("revoked");
    expect((await svc.adminOrders("refunded"))[0].status).toBe("refunded");

    const open = await svc.createOrder({ planKey: "annual", email: "open@example.test" });
    await svc.cancelOrder(open.id);
    await expect(svc.start(open.token, "stripe")).rejects.toThrow();
  });
});

import * as crypto from "node:crypto";
import { safeEqual } from "./payment-crypto";

/** The HTTP call the clients use. Replaced by a fake in tests so no real gateway is ever contacted. */
export interface HttpResult {
  status: number;
  text(): Promise<string>;
}
export type HttpFn = (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<HttpResult>;

export const realHttp: HttpFn = async (url, init) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, text: () => res.text() };
};

async function json<T>(res: HttpResult): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`The gateway answered with something that is not JSON (HTTP ${res.status}).`);
  }
}

// ───────────────────────────── Stripe ─────────────────────────────

export interface StripeSession {
  id: string;
  url: string;
}

export async function stripeCreateSession(
  http: HttpFn,
  secretKey: string,
  p: {
    orderId: string;
    orderToken: string;
    amountMinor: number;
    productName: string;
    email: string;
    successUrl: string;
    cancelUrl: string;
  }
): Promise<StripeSession> {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: p.successUrl,
    cancel_url: p.cancelUrl,
    customer_email: p.email,
    client_reference_id: p.orderId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(p.amountMinor),
    "line_items[0][price_data][product_data][name]": p.productName,
    "metadata[order_id]": p.orderId,
    "payment_intent_data[metadata][order_id]": p.orderId,
  }).toString();
  const res = await http("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `mjdm-${p.orderToken}-${p.amountMinor}`,
    },
    body,
  });
  const data = await json<{ id?: string; url?: string; error?: { message?: string } }>(res);
  if (res.status >= 300 || !data.id || !data.url) {
    throw new Error(`Stripe refused the checkout: ${data.error?.message ?? `HTTP ${res.status}`}`);
  }
  return { id: data.id, url: data.url };
}

/** Stripe-Signature: `t=<unix>,v1=<hmac>`; the HMAC is SHA-256 over `<t>.<raw body>`. */
export function stripeVerify(raw: string, header: string | undefined, secret: string, nowSec: number, toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=", 2));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0 || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => safeEqual(s, expected));
}

// ───────────────────────────── Cryptomus ─────────────────────────────

export function cryptomusSign(bodyJson: string, apiKey: string): string {
  return crypto.createHash("md5").update(Buffer.from(bodyJson).toString("base64") + apiKey).digest("hex");
}

export async function cryptomusCreateInvoice(
  http: HttpFn,
  c: { merchantUuid: string; apiKey: string },
  p: { orderId: string; amountUsd: string; callbackUrl: string; returnUrl: string; successUrl: string }
): Promise<{ url: string; uuid: string }> {
  const body = JSON.stringify({
    amount: p.amountUsd,
    currency: "USD",
    order_id: p.orderId,
    url_callback: p.callbackUrl,
    url_return: p.returnUrl,
    url_success: p.successUrl,
    lifetime: 3600,
  });
  const res = await http("https://api.cryptomus.com/v1/payment", {
    method: "POST",
    headers: { merchant: c.merchantUuid, sign: cryptomusSign(body, c.apiKey), "Content-Type": "application/json" },
    body,
  });
  const data = await json<{ state?: number; result?: { url?: string; uuid?: string }; message?: string }>(res);
  if (res.status >= 300 || data.state !== 0 || !data.result?.url || !data.result.uuid) {
    throw new Error(`Cryptomus refused the invoice: ${data.message ?? `HTTP ${res.status}`}`);
  }
  return { url: data.result.url, uuid: data.result.uuid };
}

/** The callback is signed over the JSON without its `sign` member (PHP escapes "/", JS does not: both are tried). */
export function cryptomusVerify(payload: Record<string, unknown>, apiKey: string): boolean {
  const sign = payload.sign;
  if (typeof sign !== "string" || !apiKey) return false;
  const rest = { ...payload };
  delete rest.sign;
  const plain = JSON.stringify(rest);
  const candidates = [plain, plain.replace(/\//g, "\\/")];
  return candidates.some((c) => safeEqual(cryptomusSign(c, apiKey), sign));
}

// ───────────────────────────── bKash (tokenized checkout) ─────────────────────────────

export function bkashBase(mode: string): string {
  return mode === "test"
    ? "https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout"
    : "https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout";
}

export interface BkashCreds {
  username: string;
  password: string;
  appKey: string;
  appSecret: string;
  mode: string;
}

async function bkashToken(http: HttpFn, c: BkashCreds): Promise<string> {
  const res = await http(`${bkashBase(c.mode)}/token/grant`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", username: c.username, password: c.password },
    body: JSON.stringify({ app_key: c.appKey, app_secret: c.appSecret }),
  });
  const data = await json<{ id_token?: string; statusMessage?: string }>(res);
  if (!data.id_token) throw new Error(`bKash did not give a token: ${data.statusMessage ?? `HTTP ${res.status}`}`);
  return data.id_token;
}

function bkashHeaders(token: string, c: BkashCreds): Record<string, string> {
  return { "Content-Type": "application/json", Accept: "application/json", Authorization: token, "X-APP-Key": c.appKey };
}

export async function bkashCreatePayment(
  http: HttpFn,
  c: BkashCreds,
  p: { orderId: string; amountTaka: number; callbackUrl: string }
): Promise<{ paymentId: string; url: string }> {
  const token = await bkashToken(http, c);
  const res = await http(`${bkashBase(c.mode)}/create`, {
    method: "POST",
    headers: bkashHeaders(token, c),
    body: JSON.stringify({
      mode: "0011",
      payerReference: "MJDM",
      callbackURL: p.callbackUrl,
      amount: p.amountTaka.toFixed(2),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: p.orderId,
    }),
  });
  const data = await json<{ paymentID?: string; bkashURL?: string; statusCode?: string; statusMessage?: string }>(res);
  if (data.statusCode !== "0000" || !data.paymentID || !data.bkashURL) {
    throw new Error(`bKash refused the payment: ${data.statusMessage ?? `HTTP ${res.status}`}`);
  }
  return { paymentId: data.paymentID, url: data.bkashURL };
}

export interface BkashResult {
  completed: boolean;
  trxId?: string;
  amount?: number;
  invoice?: string;
  message?: string;
}

/** Executes the payment after the customer approved it, and reports what bKash says really happened. */
export async function bkashExecute(http: HttpFn, c: BkashCreds, paymentId: string): Promise<BkashResult> {
  const token = await bkashToken(http, c);
  const res = await http(`${bkashBase(c.mode)}/execute`, {
    method: "POST",
    headers: bkashHeaders(token, c),
    body: JSON.stringify({ paymentID: paymentId }),
  });
  const d = await json<{
    statusCode?: string;
    statusMessage?: string;
    transactionStatus?: string;
    trxID?: string;
    amount?: string;
    merchantInvoiceNumber?: string;
  }>(res);
  const completed = d.statusCode === "0000" && d.transactionStatus === "Completed";
  return {
    completed,
    trxId: d.trxID,
    amount: d.amount ? Number.parseFloat(d.amount) : undefined,
    invoice: d.merchantInvoiceNumber,
    message: d.statusMessage,
  };
}

// ───────────────────────────── bKash personal: SMS parsing ─────────────────────────────

export interface BkashSms {
  amountTaka: number;
  sender: string;
  trxId: string;
}

/** "You have received Tk 999.00 from 01712345678. ... TrxID AB12CD34EF at ..." */
export function parseBkashSms(text: string): BkashSms | null {
  const amount = /received\s+Tk\.?\s*([\d,]+(?:\.\d+)?)\s+from\s+(\+?\d{10,14})/i.exec(text);
  const trx = /TrxID\s*:?\s*([A-Z0-9]{8,12})/i.exec(text);
  if (!amount || !trx) return null;
  const taka = Number.parseFloat(amount[1].replace(/,/g, ""));
  if (!Number.isFinite(taka) || taka <= 0) return null;
  return { amountTaka: taka, sender: amount[2], trxId: trx[1].toUpperCase() };
}

// ───────────────────────────── Binance (deposit history) ─────────────────────────────

export interface BinanceDeposit {
  amount: string;
  coin: string;
  network: string;
  status: number; // 1 = success
  address: string;
  txId: string;
  insertTime: number;
}

function binanceQuery(secret: string, params: Record<string, string | number>, now: number): string {
  const q = new URLSearchParams(Object.entries({ ...params, timestamp: now, recvWindow: 10000 }).map(([k, v]) => [k, String(v)]));
  const sig = crypto.createHmac("sha256", secret).update(q.toString()).digest("hex");
  return `${q.toString()}&signature=${sig}`;
}

/** Recent successful deposits of one coin (read-only API key is enough). */
export async function binanceDeposits(
  http: HttpFn,
  c: { apiKey: string; apiSecret: string },
  coin: string,
  sinceMs: number,
  nowMs: number
): Promise<BinanceDeposit[]> {
  const query = binanceQuery(c.apiSecret, { coin, startTime: sinceMs, status: 1, limit: 1000 }, nowMs);
  const res = await http(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${query}`, {
    method: "GET",
    headers: { "X-MBX-APIKEY": c.apiKey },
  });
  const data = await json<BinanceDeposit[] | { msg?: string }>(res);
  if (!Array.isArray(data)) throw new Error(`Binance refused the request: ${data.msg ?? `HTTP ${res.status}`}`);
  return data.filter((d) => d.status === 1);
}

/** Does this list contain the transaction the customer reported, for at least the expected amount? */
export function findDepositByTxId(deposits: BinanceDeposit[], txId: string, coins: string[], minAmount: number): BinanceDeposit | undefined {
  const wanted = txId.trim().toLowerCase();
  return deposits.find(
    (d) => d.txId.toLowerCase() === wanted && coins.includes(d.coin) && Number.parseFloat(d.amount) + 1e-9 >= minAmount
  );
}

/** Auto-match: a deposit to this address and network for exactly this amount. */
export function findDepositByAmount(
  deposits: BinanceDeposit[],
  match: { address: string; network: string; coin: string; amount: number },
  usedTxIds: Set<string>
): BinanceDeposit | undefined {
  return deposits.find(
    (d) =>
      d.coin === match.coin &&
      d.network === match.network &&
      d.address.toLowerCase() === match.address.toLowerCase() &&
      Math.abs(Number.parseFloat(d.amount) - match.amount) < 0.000001 &&
      !usedTxIds.has(d.txId.toLowerCase())
  );
}

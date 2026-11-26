import * as crypto from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

export type OrderStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded";

export interface OrderRecord {
  id: string;
  token: string;
  email: string;
  customerName: string | null;
  planKey: "lifetime" | "annual";
  planId: string;
  baseUsdMinor: number;
  baseBdt: number;
  status: OrderStatus;
  gatewaySlug: string | null;
  gatewayRef: string | null;
  currency: "USD" | "BDT" | null;
  amountDueMinor: number | null;
  chainCoin: string | null;
  chainNetwork: string | null;
  chainAddress: string | null;
  licenseId: string | null;
  keyEnc: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string;
}

export interface SubmissionRecord {
  id: string;
  orderId: string;
  gatewaySlug: string;
  trxId: string;
  sender: string | null;
  status: "pending" | "approved" | "rejected";
  verifiedBy: string | null;
  adminNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface GatewayRow {
  slug: string;
  enabled: boolean;
  mode: "live" | "test";
  sortOrder: number;
  configEnc: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface BkashNumber {
  id: string;
  number: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
}

export interface SmsEvent {
  id: string;
  trxId: string | null;
  amountTaka: number | null;
  sender: string | null;
  matchedOrder: string | null;
  note: string | null;
  createdAt: string;
}

export class DuplicateTransactionError extends Error {
  constructor() {
    super("That transaction id was already used for a payment.");
  }
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: unknown): string | null => (v == null ? null : iso(v));

function orderFromRow(r: Record<string, unknown>): OrderRecord {
  return {
    id: String(r.id),
    token: String(r.token),
    email: String(r.email),
    customerName: (r.customer_name as string | null) ?? null,
    planKey: r.plan_key as OrderRecord["planKey"],
    planId: String(r.plan_id),
    baseUsdMinor: Number(r.base_usd_minor),
    baseBdt: Number(r.base_bdt),
    status: r.status as OrderStatus,
    gatewaySlug: (r.gateway_slug as string | null) ?? null,
    gatewayRef: (r.gateway_ref as string | null) ?? null,
    currency: ((r.currency as string | null)?.trim() as OrderRecord["currency"]) ?? null,
    amountDueMinor: r.amount_due_minor == null ? null : Number(r.amount_due_minor),
    chainCoin: (r.chain_coin as string | null) ?? null,
    chainNetwork: (r.chain_network as string | null) ?? null,
    chainAddress: (r.chain_address as string | null) ?? null,
    licenseId: (r.license_id as string | null) ?? null,
    keyEnc: (r.key_enc as string | null) ?? null,
    meta: (r.meta as Record<string, unknown>) ?? {},
    createdAt: iso(r.created_at),
    paidAt: isoOrNull(r.paid_at),
    expiresAt: iso(r.expires_at),
  };
}

function submissionFromRow(r: Record<string, unknown>): SubmissionRecord {
  return {
    id: String(r.id),
    orderId: String(r.order_id),
    gatewaySlug: String(r.gateway_slug),
    trxId: String(r.trx_id),
    sender: (r.sender as string | null) ?? null,
    status: r.status as SubmissionRecord["status"],
    verifiedBy: (r.verified_by as string | null) ?? null,
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: iso(r.created_at),
    decidedAt: isoOrNull(r.decided_at),
    decidedBy: (r.decided_by as string | null) ?? null,
  };
}

function gatewayFromRow(r: Record<string, unknown>): GatewayRow {
  return {
    slug: String(r.slug),
    enabled: Boolean(r.enabled),
    mode: (r.mode as GatewayRow["mode"]) ?? "live",
    sortOrder: Number(r.sort_order ?? 0),
    configEnc: (r.config_enc as string | null) ?? null,
    updatedAt: iso(r.updated_at),
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

/** PostgreSQL when connected, otherwise in memory (tests and a database-less dev run). */
@Injectable()
export class PaymentsStore {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly submissions = new Map<string, SubmissionRecord>();
  private readonly gateways = new Map<string, GatewayRow>();
  private readonly numbers = new Map<string, BkashNumber>();
  private readonly sms = new Map<string, SmsEvent>();

  constructor(@Optional() @Inject(DatabaseService) private readonly db?: DatabaseService) {}

  private get live(): boolean {
    return Boolean(this.db?.connected);
  }

  private q(text: string, values: unknown[] = []) {
    return (this.db as DatabaseService).query<Record<string, unknown>>(text, values);
  }

  // ── gateways ──
  async listGateways(): Promise<GatewayRow[]> {
    if (this.live) return (await this.q("SELECT * FROM payment_gateways ORDER BY sort_order, slug")).rows.map(gatewayFromRow);
    return [...this.gateways.values()];
  }

  async getGateway(slug: string): Promise<GatewayRow | null> {
    if (this.live) {
      const r = await this.q("SELECT * FROM payment_gateways WHERE slug=$1", [slug]);
      return r.rows[0] ? gatewayFromRow(r.rows[0]) : null;
    }
    return this.gateways.get(slug) ?? null;
  }

  async saveGateway(g: Omit<GatewayRow, "updatedAt">): Promise<void> {
    if (this.live) {
      await this.q(
        `INSERT INTO payment_gateways (slug, enabled, mode, sort_order, config_enc, updated_at, updated_by)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6)
         ON CONFLICT (slug) DO UPDATE SET enabled=$2, mode=$3, sort_order=$4, config_enc=$5, updated_at=NOW(), updated_by=$6`,
        [g.slug, g.enabled, g.mode, g.sortOrder, g.configEnc, g.updatedBy]
      );
      return;
    }
    this.gateways.set(g.slug, { ...g, updatedAt: new Date().toISOString() });
  }

  // ── orders ──
  async insertOrder(o: OrderRecord): Promise<void> {
    if (this.live) {
      await this.q(
        `INSERT INTO orders (id, token, email, customer_name, plan_key, plan_id, base_usd_minor, base_bdt, status, meta, created_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [o.id, o.token, o.email, o.customerName, o.planKey, o.planId, o.baseUsdMinor, o.baseBdt, o.status, JSON.stringify(o.meta), o.createdAt, o.expiresAt]
      );
      return;
    }
    this.orders.set(o.id, { ...o });
  }

  async getOrderByToken(token: string): Promise<OrderRecord | null> {
    if (this.live) {
      const r = await this.q("SELECT * FROM orders WHERE token=$1", [token]);
      return r.rows[0] ? orderFromRow(r.rows[0]) : null;
    }
    return [...this.orders.values()].find((o) => o.token === token) ?? null;
  }

  async getOrder(id: string): Promise<OrderRecord | null> {
    if (this.live) {
      const r = await this.q("SELECT * FROM orders WHERE id=$1", [id]);
      return r.rows[0] ? orderFromRow(r.rows[0]) : null;
    }
    return this.orders.get(id) ?? null;
  }

  async listOrders(status?: string, limit = 200): Promise<OrderRecord[]> {
    if (this.live) {
      const r = status
        ? await this.q("SELECT * FROM orders WHERE status=$1 ORDER BY created_at DESC LIMIT $2", [status, limit])
        : await this.q("SELECT * FROM orders ORDER BY created_at DESC LIMIT $1", [limit]);
      return r.rows.map(orderFromRow);
    }
    return [...this.orders.values()]
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /** Sets fields on a pending order. */
  async updateOrder(id: string, patch: Partial<Omit<OrderRecord, "id" | "token">>): Promise<void> {
    const map: Record<string, string> = {
      status: "status", gatewaySlug: "gateway_slug", gatewayRef: "gateway_ref", currency: "currency",
      amountDueMinor: "amount_due_minor", chainCoin: "chain_coin", chainNetwork: "chain_network",
      chainAddress: "chain_address", licenseId: "license_id", keyEnc: "key_enc", meta: "meta", paidAt: "paid_at",
    };
    if (this.live) {
      const sets: string[] = [];
      const values: unknown[] = [id];
      for (const [k, v] of Object.entries(patch)) {
        const col = map[k];
        if (!col) continue;
        values.push(k === "meta" ? JSON.stringify(v) : v);
        sets.push(`${col}=$${values.length}`);
      }
      if (sets.length) await this.q(`UPDATE orders SET ${sets.join(", ")} WHERE id=$1`, values);
      return;
    }
    const cur = this.orders.get(id);
    if (cur) this.orders.set(id, { ...cur, ...patch });
  }

  /** Atomically moves a pending order to paid. Returns false when somebody else already did. */
  async claimPaid(id: string, gatewaySlug: string, ref: string | null): Promise<boolean> {
    const paidAt = new Date().toISOString();
    if (this.live) {
      const r = await this.q(
        `UPDATE orders SET status='paid', paid_at=$2, gateway_slug=COALESCE(gateway_slug,$3), gateway_ref=COALESCE($4,gateway_ref)
          WHERE id=$1 AND status='pending' RETURNING id`,
        [id, paidAt, gatewaySlug, ref]
      );
      return r.rows.length === 1;
    }
    const cur = this.orders.get(id);
    if (!cur || cur.status !== "pending") return false;
    this.orders.set(id, { ...cur, status: "paid", paidAt, gatewaySlug: cur.gatewaySlug ?? gatewaySlug, gatewayRef: ref ?? cur.gatewayRef });
    return true;
  }

  async expireOldOrders(now: Date): Promise<void> {
    if (this.live) {
      await this.q("UPDATE orders SET status='expired' WHERE status='pending' AND expires_at < $1", [now.toISOString()]);
      return;
    }
    for (const o of this.orders.values()) if (o.status === "pending" && o.expiresAt < now.toISOString()) o.status = "expired";
  }

  async pendingChainOrders(): Promise<OrderRecord[]> {
    if (this.live) {
      const r = await this.q("SELECT * FROM orders WHERE status='pending' AND gateway_slug='binance_chain' AND chain_address IS NOT NULL");
      return r.rows.map(orderFromRow);
    }
    return [...this.orders.values()].filter((o) => o.status === "pending" && o.gatewaySlug === "binance_chain" && o.chainAddress);
  }

  async usedReferences(slug: string): Promise<Set<string>> {
    if (this.live) {
      const r = await this.q("SELECT gateway_ref FROM orders WHERE gateway_slug=$1 AND status='paid' AND gateway_ref IS NOT NULL", [slug]);
      return new Set(r.rows.map((x) => String(x.gateway_ref).toLowerCase()));
    }
    return new Set([...this.orders.values()].filter((o) => o.gatewaySlug === slug && o.status === "paid" && o.gatewayRef).map((o) => o.gatewayRef!.toLowerCase()));
  }

  // ── submissions ──
  async insertSubmission(s: SubmissionRecord): Promise<void> {
    if (this.live) {
      try {
        await this.q(
          `INSERT INTO payment_submissions (id, order_id, gateway_slug, trx_id, sender, status, verified_by, admin_note, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [s.id, s.orderId, s.gatewaySlug, s.trxId, s.sender, s.status, s.verifiedBy, s.adminNote, s.createdAt]
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new DuplicateTransactionError();
        throw e;
      }
      return;
    }
    const dup = [...this.submissions.values()].some(
      (x) => x.gatewaySlug === s.gatewaySlug && x.trxId.toUpperCase() === s.trxId.toUpperCase() && x.status !== "rejected"
    );
    if (dup) throw new DuplicateTransactionError();
    this.submissions.set(s.id, { ...s });
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    if (this.live) {
      const r = await this.q("SELECT * FROM payment_submissions WHERE id=$1", [id]);
      return r.rows[0] ? submissionFromRow(r.rows[0]) : null;
    }
    return this.submissions.get(id) ?? null;
  }

  async listSubmissions(status?: string): Promise<SubmissionRecord[]> {
    if (this.live) {
      const r = status
        ? await this.q("SELECT * FROM payment_submissions WHERE status=$1 ORDER BY created_at DESC LIMIT 300", [status])
        : await this.q("SELECT * FROM payment_submissions ORDER BY created_at DESC LIMIT 300");
      return r.rows.map(submissionFromRow);
    }
    return [...this.submissions.values()].filter((s) => !status || s.status === status).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async submissionsForOrder(orderId: string): Promise<SubmissionRecord[]> {
    if (this.live) {
      return (await this.q("SELECT * FROM payment_submissions WHERE order_id=$1 ORDER BY created_at DESC", [orderId])).rows.map(submissionFromRow);
    }
    return [...this.submissions.values()].filter((s) => s.orderId === orderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async decideSubmission(id: string, status: "approved" | "rejected", by: string, note?: string, verifiedBy?: string): Promise<boolean> {
    const at = new Date().toISOString();
    if (this.live) {
      const r = await this.q(
        `UPDATE payment_submissions SET status=$2, decided_at=$3, decided_by=$4, admin_note=COALESCE($5,admin_note), verified_by=COALESCE($6,verified_by)
          WHERE id=$1 AND status='pending' RETURNING id`,
        [id, status, at, by, note ?? null, verifiedBy ?? null]
      );
      return r.rows.length === 1;
    }
    const cur = this.submissions.get(id);
    if (!cur || cur.status !== "pending") return false;
    this.submissions.set(id, { ...cur, status, decidedAt: at, decidedBy: by, adminNote: note ?? cur.adminNote, verifiedBy: verifiedBy ?? cur.verifiedBy });
    return true;
  }

  async decideSubmissionNote(id: string, note: string): Promise<void> {
    if (this.live) {
      await this.q("UPDATE payment_submissions SET admin_note=$2 WHERE id=$1 AND status='pending'", [id, note]);
      return;
    }
    const cur = this.submissions.get(id);
    if (cur && cur.status === "pending") this.submissions.set(id, { ...cur, adminNote: note });
  }

  // ── bKash numbers ──
  async listNumbers(): Promise<BkashNumber[]> {
    if (this.live) {
      return (await this.q("SELECT * FROM bkash_numbers ORDER BY created_at")).rows.map((r) => ({
        id: String(r.id), number: String(r.number), label: (r.label as string | null) ?? null, enabled: Boolean(r.enabled), createdAt: iso(r.created_at),
      }));
    }
    return [...this.numbers.values()];
  }

  async addNumber(number: string, label: string | null): Promise<BkashNumber> {
    const rec: BkashNumber = { id: crypto.randomUUID(), number, label, enabled: true, createdAt: new Date().toISOString() };
    if (this.live) {
      await this.q("INSERT INTO bkash_numbers (id, number, label, enabled) VALUES ($1,$2,$3,TRUE)", [rec.id, number, label]);
    } else {
      if ([...this.numbers.values()].some((n) => n.number === number)) throw new DuplicateTransactionError();
      this.numbers.set(rec.id, rec);
    }
    return rec;
  }

  async updateNumber(id: string, patch: { enabled?: boolean; label?: string | null }): Promise<void> {
    if (this.live) {
      if (patch.enabled !== undefined) await this.q("UPDATE bkash_numbers SET enabled=$2 WHERE id=$1", [id, patch.enabled]);
      if (patch.label !== undefined) await this.q("UPDATE bkash_numbers SET label=$2 WHERE id=$1", [id, patch.label]);
      return;
    }
    const cur = this.numbers.get(id);
    if (cur) this.numbers.set(id, { ...cur, ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) });
  }

  async removeNumber(id: string): Promise<void> {
    if (this.live) await this.q("DELETE FROM bkash_numbers WHERE id=$1", [id]);
    else this.numbers.delete(id);
  }

  // ── SMS events ──
  async addSms(e: Omit<SmsEvent, "id" | "createdAt">): Promise<SmsEvent> {
    const rec: SmsEvent = { ...e, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    if (this.live) {
      await this.q(
        "INSERT INTO bkash_sms_events (id, trx_id, amount_taka, sender, matched_order, note) VALUES ($1,$2,$3,$4,$5,$6)",
        [rec.id, rec.trxId, rec.amountTaka, rec.sender, rec.matchedOrder, rec.note]
      );
    } else this.sms.set(rec.id, rec);
    return rec;
  }

  async findUnmatchedSms(trxId: string): Promise<SmsEvent | null> {
    if (this.live) {
      const r = await this.q("SELECT * FROM bkash_sms_events WHERE upper(trx_id)=upper($1) AND matched_order IS NULL ORDER BY created_at DESC LIMIT 1", [trxId]);
      const x = r.rows[0];
      return x ? { id: String(x.id), trxId: x.trx_id as string, amountTaka: x.amount_taka == null ? null : Number(x.amount_taka), sender: x.sender as string | null, matchedOrder: null, note: x.note as string | null, createdAt: iso(x.created_at) } : null;
    }
    return [...this.sms.values()].find((s) => s.trxId?.toUpperCase() === trxId.toUpperCase() && !s.matchedOrder) ?? null;
  }

  async markSmsMatched(id: string, orderId: string): Promise<void> {
    if (this.live) await this.q("UPDATE bkash_sms_events SET matched_order=$2 WHERE id=$1", [id, orderId]);
    else {
      const cur = this.sms.get(id);
      if (cur) this.sms.set(id, { ...cur, matchedOrder: orderId });
    }
  }
}

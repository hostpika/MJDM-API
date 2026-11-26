import * as crypto from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BillingService } from "../billing/billing.service";
import { DatabaseService } from "../database/database.service";
import { LicensesService } from "../licenses/licenses.service";
import { PaymentsService } from "../payments/payments.service";

export interface AdminStats {
  totalUsers: number;
  activeLicenses: number;
  activeDevices: number;
  totalRevenueMinor: number;
  totalRevenueFormatted: string;
  /** "database" = live numbers; "memory" = no database connected, so real but lost on restart. */
  source: "database" | "memory";
  /** Money collected from checkout orders, per currency (what customers paid, fees included). */
  revenue?: { currency: string; minor: number; text: string }[];
  revenueLast30Days?: { currency: string; minor: number; text: string }[];
  paidOrders?: number;
  pendingOrders?: number;
  reportsWaiting?: number;
  revokedLicenses?: number;
}

export interface AuditLogEntry {
  id: string;
  actorType: "admin" | "system";
  actorId: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

interface RawAuditRow {
  id: string;
  actor_type: "admin" | "system";
  actor_id: string;
  action: string;
  resource: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly memoryAuditLogs: AuditLogEntry[] = [];

  constructor(
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
    @Optional() @Inject(LicensesService) private readonly licensesService?: LicensesService,
    @Optional() @Inject(BillingService) private readonly billingService?: BillingService,
    @Optional() @Inject(PaymentsService) private readonly paymentsService?: PaymentsService
  ) {}

  async getStats(): Promise<AdminStats> {
    if (this.db?.connected) {
      const db = this.db;
      const one = async (sql: string): Promise<number> => {
        const r = await db.query<{ n: string | null }>(sql);
        return Number(r.rows[0]?.n ?? 0);
      };
      const orders = (await this.paymentsService?.overview()) ?? null;
      const usd = orders?.revenue.find((r) => r.currency === "USD")?.minor ?? 0;
      return {
        totalUsers: await one("SELECT COUNT(*) AS n FROM users"),
        activeLicenses: await one("SELECT COUNT(*) AS n FROM licenses WHERE status = 'active'"),
        revokedLicenses: await one("SELECT COUNT(*) AS n FROM licenses WHERE status <> 'active'"),
        activeDevices: await one(
          "SELECT COUNT(*) AS n FROM license_activations WHERE status = 'active'"
        ),
        totalRevenueMinor: usd,
        totalRevenueFormatted: `$${(usd / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        source: "database",
        ...(orders ?? {}),
      };
    }
    // No database connected (development / tests): the real in-memory numbers, clearly marked.
    const counts = (await this.licensesService?.licenseCounts()) ?? { active: 0, revoked: 0, devices: 0, customers: 0 };
    const orders = (await this.paymentsService?.overview()) ?? null;
    const usd = orders?.revenue.find((r) => r.currency === "USD")?.minor ?? 0;
    return {
      totalUsers: counts.customers,
      activeLicenses: counts.active,
      revokedLicenses: counts.revoked,
      activeDevices: counts.devices,
      totalRevenueMinor: usd,
      totalRevenueFormatted: `$${(usd / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      source: "memory",
      ...(orders ?? {}),
    };
  }

  async recordAudit(
    actorId: string,
    action: string,
    resource: string,
    resourceId?: string,
    metadata?: Record<string, unknown>,
    ipAddress?: string
  ): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      actorType: "admin",
      actorId,
      action,
      resource,
      resourceId,
      metadata,
      ipAddress: ipAddress ?? "127.0.0.1",
      createdAt: new Date().toISOString(),
    };

    this.memoryAuditLogs.unshift(entry);

    if (this.db?.connected) {
      try {
        await this.db.query(
          `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource, resource_id, metadata, ip_address, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [entry.id, entry.actorType, entry.actorId, entry.action, entry.resource, entry.resourceId ?? null, JSON.stringify(entry.metadata ?? {}), entry.ipAddress, entry.createdAt]
        );
      } catch (err) {
        // The change the admin made has already happened; a failed log line must not report it as an error.
        this.logger.error(`Could not write the audit log entry: ${String(err)}`);
      }
    }

    this.logger.log(`[Audit] ${actorId} executed ${action} on ${resource}:${resourceId ?? "all"}`);
    return entry;
  }

  async getAuditLogs(limit = 100): Promise<AuditLogEntry[]> {
    if (this.db?.connected) {
      const res = await this.db.query<RawAuditRow>(
        "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      return res.rows.map((r: RawAuditRow) => ({
        id: r.id,
        actorType: r.actor_type,
        actorId: r.actor_id,
        action: r.action,
        resource: r.resource,
        resourceId: r.resource_id ?? undefined,
        metadata: r.metadata ?? undefined,
        ipAddress: r.ip_address ?? undefined,
        createdAt: r.created_at,
      }));
    }
    return this.memoryAuditLogs.slice(0, limit);
  }
}

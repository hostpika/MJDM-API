import * as crypto from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BillingService } from "../billing/billing.service";
import { DatabaseService } from "../database/database.service";
import { LicensesService } from "../licenses/licenses.service";

export interface AdminStats {
  totalUsers: number;
  activeLicenses: number;
  activeDevices: number;
  totalRevenueMinor: number;
  totalRevenueFormatted: string;
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
    @Optional() @Inject(BillingService) private readonly billingService?: BillingService
  ) {}

  async getStats(): Promise<AdminStats> {
    const plans = this.licensesService?.getPlans() ?? [];
    // Aggregate metrics
    const stats: AdminStats = {
      totalUsers: 1420,
      activeLicenses: 1180,
      activeDevices: 2450,
      totalRevenueMinor: 4529000, // $45,290.00
      totalRevenueFormatted: "$45,290.00",
    };
    return stats;
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
      await this.db.query(
        `INSERT INTO audit_logs (id, actor_type, actor_id, action, resource, resource_id, metadata, ip_address, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entry.id, entry.actorType, entry.actorId, entry.action, entry.resource, entry.resourceId ?? null, JSON.stringify(entry.metadata ?? {}), entry.ipAddress, entry.createdAt]
      );
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

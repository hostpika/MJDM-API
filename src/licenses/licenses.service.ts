import * as crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../database/database.service";
import { ActivateLicenseDto, DeactivateLicenseDto, RefreshLicenseDto } from "./dto/licenses.dto";
import { Es256Service } from "./es256.service";
import { LicenseKeyService } from "./key-generator";

export interface PlanRecord {
  id: string;
  name: string;
  plan_type: "lifetime" | "annual" | "monthly";
  max_devices: number;
  price_minor: number;
  duration_days: number | null;
}

export interface LicenseRecord {
  id: string;
  user_id: string;
  plan_id: string;
  key_hmac: string;
  status: "active" | "revoked" | "expired" | "refunded";
  expires_at: string | null;
  created_at: string;
  /** "manual" (issued by an admin) or the payment gateway that sold it. */
  source?: string;
  note?: string | null;
  issued_by?: string | null;
}

export interface CustomerRecord {
  id: string;
  email: string;
  display_name: string | null;
}

export interface AdminLicenseRow {
  id: string;
  email: string;
  customerName: string | null;
  planId: string;
  planName: string;
  planType: string;
  status: string;
  source: string;
  note: string | null;
  issuedBy: string | null;
  activeDevices: number;
  maxDevices: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateLicenseOptions {
  source?: string;
  note?: string;
  issuedBy?: string;
}

export interface DeviceRecord {
  id: string;
  user_id: string;
  device_uuid: string;
  platform: string;
  os_version: string | null;
  app_version: string | null;
  device_name: string | null;
  last_seen_at: string;
}

export interface ActivationRecord {
  id: string;
  license_id: string;
  device_id: string;
  status: "active" | "revoked";
  activated_at: string;
  revoked_at: string | null;
}

export interface ActivationResponse {
  licenseId: string;
  plan: string;
  maxDevices: number;
  activeDevices: number;
  token: string;
  expiresAt: string;
  graceExpiresAt: string;
}

@Injectable()
export class LicensesService {
  // In-memory fallback repositories
  private readonly memoryPlans = new Map<string, PlanRecord>();
  private readonly memoryLicenses = new Map<string, LicenseRecord>();
  private readonly memoryDevices = new Map<string, DeviceRecord>();
  private readonly memoryActivations = new Map<string, ActivationRecord>();
  private readonly memoryCustomers = new Map<string, CustomerRecord>();

  private es256: Es256Service;

  constructor(
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
    @Optional() @Inject(AppConfigService) private readonly config?: AppConfigService,
    @Optional() @Inject(Es256Service) es256?: Es256Service
  ) {
    this.seedDefaultPlans();
    this.es256 = es256 ?? new Es256Service(this.config);
    this.es256.onModuleInit();
  }

  private seedDefaultPlans(): void {
    const plans: PlanRecord[] = [
      {
        id: "plan-lifetime-pro",
        name: "Lifetime Pro",
        plan_type: "lifetime",
        max_devices: 3,
        price_minor: 2999, // $29.99
        duration_days: null,
      },
      {
        id: "plan-annual-personal",
        name: "1-Year Personal",
        plan_type: "annual",
        max_devices: 1,
        price_minor: 1499, // $14.99
        duration_days: 365,
      },
      {
        id: "plan-annual-family",
        name: "1-Year Family",
        plan_type: "annual",
        max_devices: 5,
        price_minor: 3999, // $39.99
        duration_days: 365,
      },
    ];

    for (const p of plans) {
      this.memoryPlans.set(p.id, p);
    }
  }

  getPlans(): PlanRecord[] {
    return Array.from(this.memoryPlans.values());
  }

  /**
   * Creates a new license for a user & plan, returning the plaintext key.
   * Key is hashed immediately via HMAC and never stored plaintext.
   */
  async createLicense(
    userId: string,
    planId: string,
    options: CreateLicenseOptions = {}
  ): Promise<{ licenseId: string; key: string; plan: PlanRecord }> {
    const plan = this.memoryPlans.get(planId);
    if (!plan) {
      throw new NotFoundException(`Plan ${planId} not found`);
    }

    const key = LicenseKeyService.generate();
    const pepper =
      this.config?.get("SERVER_PEPPER") ??
      process.env.SERVER_PEPPER ??
      "mjdm_server_pepper_for_license_hmac_32_chars_min!";
    const keyHmac = LicenseKeyService.computeHmac(key, pepper);

    const licenseId = crypto.randomUUID();
    const now = new Date();
    let expiresAt: string | null = null;
    if (plan.duration_days) {
      const exp = new Date(now.getTime() + plan.duration_days * 24 * 60 * 60 * 1000);
      expiresAt = exp.toISOString();
    }

    const license: LicenseRecord = {
      id: licenseId,
      user_id: userId,
      plan_id: plan.id,
      key_hmac: keyHmac,
      status: "active",
      expires_at: expiresAt,
      created_at: now.toISOString(),
      source: options.source ?? "manual",
      note: options.note ?? null,
      issued_by: options.issuedBy ?? null,
    };

    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO licenses (id, user_id, plan_id, key_hmac, status, expires_at, created_at, source, note, issued_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [license.id, license.user_id, license.plan_id, license.key_hmac, license.status, license.expires_at, license.created_at, license.source, license.note, license.issued_by]
      );
    } else {
      this.memoryLicenses.set(licenseId, license);
    }

    return { licenseId, key, plan };
  }

  /** Finds the customer with this email, or creates one that cannot sign in with a password. */
  async findOrCreateCustomer(email: string, displayName?: string): Promise<CustomerRecord> {
    const clean = email.trim().toLowerCase();
    if (this.db?.connected) {
      // "!" is not a valid password hash, so a customer made by an admin cannot log in until they
      // set a password through the normal "forgot password" flow.
      const res = await this.db.query<CustomerRecord>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, '!', $2)
         ON CONFLICT (email) DO UPDATE SET display_name = COALESCE(users.display_name, EXCLUDED.display_name)
         RETURNING id, email, display_name`,
        [clean, displayName?.trim() || null]
      );
      return res.rows[0];
    }
    let c = this.memoryCustomers.get(clean);
    if (!c) {
      c = { id: crypto.randomUUID(), email: clean, display_name: displayName?.trim() || null };
      this.memoryCustomers.set(clean, c);
    }
    return c;
  }

  /** Issues a license to an email address by hand (the admin took the payment another way). */
  async issueManualLicense(input: {
    email: string;
    name?: string;
    planId: string;
    note?: string;
    issuedBy: string;
  }): Promise<{ licenseId: string; key: string; plan: PlanRecord; email: string }> {
    const customer = await this.findOrCreateCustomer(input.email, input.name);
    const made = await this.createLicense(customer.id, input.planId, {
      source: "manual",
      note: input.note,
      issuedBy: input.issuedBy,
    });
    return { ...made, email: customer.email };
  }

  /** Every license with its customer and plan. Keys are never listed: only their hash is stored. */
  async listLicensesForAdmin(): Promise<AdminLicenseRow[]> {
    const plans = new Map(this.getPlans().map((p) => [p.id, p]));
    const toRow = (
      l: LicenseRecord,
      email: string,
      name: string | null,
      activeDevices: number
    ): AdminLicenseRow => {
      const plan = plans.get(l.plan_id);
      return {
        id: l.id,
        email,
        customerName: name,
        planId: l.plan_id,
        planName: plan?.name ?? l.plan_id,
        planType: plan?.plan_type ?? "unknown",
        status: l.status,
        source: l.source ?? "manual",
        note: l.note ?? null,
        issuedBy: l.issued_by ?? null,
        activeDevices,
        maxDevices: plan?.max_devices ?? 0,
        expiresAt: l.expires_at ? new Date(l.expires_at).toISOString() : null,
        createdAt: new Date(l.created_at).toISOString(),
      };
    };

    if (this.db?.connected) {
      const res = await this.db.query<
        LicenseRecord & { email: string; display_name: string | null; active_devices: string }
      >(
        `SELECT l.*, u.email, u.display_name,
                (SELECT COUNT(*) FROM license_activations a WHERE a.license_id = l.id AND a.status = 'active') AS active_devices
           FROM licenses l JOIN users u ON u.id = l.user_id
          ORDER BY l.created_at DESC LIMIT 500`
      );
      return res.rows.map((r) => toRow(r, r.email, r.display_name, Number(r.active_devices)));
    }

    const byId = new Map([...this.memoryCustomers.values()].map((c) => [c.id, c]));
    return [...this.memoryLicenses.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((l) => {
        const c = byId.get(l.user_id);
        const active = [...this.memoryActivations.values()].filter(
          (a) => a.license_id === l.id && a.status === "active"
        ).length;
        return toRow(l, c?.email ?? "unknown", c?.display_name ?? null, active);
      });
  }

  /**
   * Activates a license for a specific device.
   * Enforces device limits per plan.
   * Issues 14-day signed ES256 JWS token + 72-hour grace.
   */
  async activate(dto: ActivateLicenseDto): Promise<ActivationResponse> {
    if (!LicenseKeyService.isValid(dto.licenseKey)) {
      throw new BadRequestException("Invalid license key format or checksum");
    }

    const pepper =
      this.config?.get("SERVER_PEPPER") ??
      process.env.SERVER_PEPPER ??
      "mjdm_server_pepper_for_license_hmac_32_chars_min!";
    const hmac = LicenseKeyService.computeHmac(dto.licenseKey, pepper);

    const license = await this.findLicenseByHmac(hmac);
    if (!license) {
      throw new NotFoundException("License not found");
    }

    if (license.status !== "active") {
      throw new ForbiddenException(`License is ${license.status}`);
    }

    if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
      license.status = "expired";
      throw new ForbiddenException("License has expired");
    }

    const plan = this.memoryPlans.get(license.plan_id) ?? {
      id: license.plan_id,
      name: "Custom Plan",
      plan_type: "lifetime" as const,
      max_devices: 3,
      price_minor: 0,
      duration_days: null,
    };

    // Find or register device
    const device = await this.findOrCreateDevice(
      license.user_id,
      dto.deviceUuid,
      dto.platform,
      dto.osVersion,
      dto.appVersion,
      dto.deviceName
    );

    // Get active activations for this license
    const activeActivations = await this.getActiveActivations(license.id);
    const existingActivation = activeActivations.find((a) => a.device_id === device.id);

    if (!existingActivation) {
      if (activeActivations.length >= plan.max_devices) {
        throw new ConflictException(
          `Device limit reached (${activeActivations.length}/${plan.max_devices}). Deactivate a device from your account to activate this device.`
        );
      }

      // Record activation
      const actRecord: ActivationRecord = {
        id: crypto.randomUUID(),
        license_id: license.id,
        device_id: device.id,
        status: "active",
        activated_at: new Date().toISOString(),
        revoked_at: null,
      };

      if (this.db?.connected) {
        await this.db.query(
          `INSERT INTO license_activations (id, license_id, device_id, status, activated_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (license_id, device_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
          [actRecord.id, actRecord.license_id, actRecord.device_id, actRecord.status, actRecord.activated_at]
        );
      } else {
        this.memoryActivations.set(`${license.id}:${device.id}`, actRecord);
      }
    }

    // Issue ES256 Token
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 14 * 24 * 60 * 60; // 14 days
    const graceExpSec = expSec + 72 * 60 * 60; // +72h grace

    const token = this.es256.signToken({
      sub: license.id,
      did: dto.deviceUuid,
      plan: plan.plan_type,
      max_devices: plan.max_devices,
      features: ["http", "media", "torrent", "remote", "sync"],
      iat: nowSec,
      exp: expSec,
      grace_exp: graceExpSec,
    });

    const activeCount = existingActivation
      ? activeActivations.length
      : activeActivations.length + 1;

    return {
      licenseId: license.id,
      plan: plan.name,
      maxDevices: plan.max_devices,
      activeDevices: activeCount,
      token,
      expiresAt: new Date(expSec * 1000).toISOString(),
      graceExpiresAt: new Date(graceExpSec * 1000).toISOString(),
    };
  }

  /**
   * Refreshes an active license token for an already activated device.
   */
  async refresh(dto: RefreshLicenseDto): Promise<ActivationResponse> {
    const license = await this.findLicenseById(dto.licenseId);
    if (!license || license.status !== "active") {
      throw new ForbiddenException("License is not active or has been revoked");
    }

    const device = await this.findDeviceByUuid(dto.deviceUuid);
    if (!device) {
      throw new NotFoundException("Device not found");
    }

    const activations = await this.getActiveActivations(license.id);
    const isDeviceActive = activations.some((a) => a.device_id === device.id);
    if (!isDeviceActive) {
      throw new ForbiddenException("Device is not actively registered for this license");
    }

    const plan = this.memoryPlans.get(license.plan_id) ?? {
      id: license.plan_id,
      name: "Standard",
      plan_type: "lifetime" as const,
      max_devices: 3,
      price_minor: 0,
      duration_days: null,
    };

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + 14 * 24 * 60 * 60;
    const graceExpSec = expSec + 72 * 60 * 60;

    const token = this.es256.signToken({
      sub: license.id,
      did: dto.deviceUuid,
      plan: plan.plan_type,
      max_devices: plan.max_devices,
      features: ["http", "media", "torrent", "remote", "sync"],
      iat: nowSec,
      exp: expSec,
      grace_exp: graceExpSec,
    });

    return {
      licenseId: license.id,
      plan: plan.name,
      maxDevices: plan.max_devices,
      activeDevices: activations.length,
      token,
      expiresAt: new Date(expSec * 1000).toISOString(),
      graceExpiresAt: new Date(graceExpSec * 1000).toISOString(),
    };
  }

  /**
   * Deactivates a device from a license, freeing up a device activation slot.
   */
  async deactivate(dto: DeactivateLicenseDto): Promise<{ success: boolean }> {
    const device = await this.findDeviceByUuid(dto.deviceUuid);
    if (!device) {
      return { success: true };
    }

    if (this.db?.connected) {
      await this.db.query(
        "UPDATE license_activations SET status = 'revoked', revoked_at = NOW() WHERE license_id = $1 AND device_id = $2",
        [dto.licenseId, device.id]
      );
    } else {
      const key = `${dto.licenseId}:${device.id}`;
      const act = this.memoryActivations.get(key);
      if (act) {
        act.status = "revoked";
        act.revoked_at = new Date().toISOString();
      }
    }

    return { success: true };
  }

  /**
   * Revokes an entire license (e.g. refund/chargeback).
   */
  async revokeLicense(licenseId: string): Promise<{ success: boolean }> {
    const license = await this.findLicenseById(licenseId);
    if (!license) {
      throw new NotFoundException("License not found");
    }

    license.status = "revoked";
    if (this.db?.connected) {
      await this.db.query("UPDATE licenses SET status = 'revoked' WHERE id = $1", [licenseId]);
      await this.db.query(
        "UPDATE license_activations SET status = 'revoked', revoked_at = NOW() WHERE license_id = $1",
        [licenseId]
      );
    } else {
      for (const act of this.memoryActivations.values()) {
        if (act.license_id === licenseId) {
          act.status = "revoked";
          act.revoked_at = new Date().toISOString();
        }
      }
    }

    return { success: true };
  }

  // --- Helper Queries ---

  private async findLicenseByHmac(hmac: string): Promise<LicenseRecord | null> {
    if (this.db?.connected) {
      const res = await this.db.query<LicenseRecord>(
        "SELECT * FROM licenses WHERE key_hmac = $1 LIMIT 1",
        [hmac]
      );
      return res.rows[0] ?? null;
    }
    for (const l of this.memoryLicenses.values()) {
      if (l.key_hmac === hmac) return l;
    }
    return null;
  }

  private async findLicenseById(id: string): Promise<LicenseRecord | null> {
    if (this.db?.connected) {
      const res = await this.db.query<LicenseRecord>(
        "SELECT * FROM licenses WHERE id = $1 LIMIT 1",
        [id]
      );
      return res.rows[0] ?? null;
    }
    return this.memoryLicenses.get(id) ?? null;
  }

  private async findOrCreateDevice(
    userId: string,
    deviceUuid: string,
    platform: string,
    osVersion?: string,
    appVersion?: string,
    deviceName?: string
  ): Promise<DeviceRecord> {
    const now = new Date().toISOString();

    if (this.db?.connected) {
      const res = await this.db.query<DeviceRecord>(
        `INSERT INTO devices (id, user_id, device_uuid, platform, os_version, app_version, device_name, last_seen_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, device_uuid) 
         DO UPDATE SET os_version = EXCLUDED.os_version, app_version = EXCLUDED.app_version, last_seen_at = EXCLUDED.last_seen_at
         RETURNING *`,
        [userId, deviceUuid, platform, osVersion ?? null, appVersion ?? null, deviceName ?? null, now]
      );
      return res.rows[0];
    }

    const key = `${userId}:${deviceUuid}`;
    let dev = this.memoryDevices.get(key);
    if (!dev) {
      dev = {
        id: crypto.randomUUID(),
        user_id: userId,
        device_uuid: deviceUuid,
        platform,
        os_version: osVersion ?? null,
        app_version: appVersion ?? null,
        device_name: deviceName ?? null,
        last_seen_at: now,
      };
      this.memoryDevices.set(key, dev);
    } else {
      dev.last_seen_at = now;
      if (osVersion) dev.os_version = osVersion;
      if (appVersion) dev.app_version = appVersion;
    }
    return dev;
  }

  async getLicensesForUser(userId: string): Promise<
    Array<{
      id: string;
      planName: string;
      planType: "lifetime" | "annual" | "monthly";
      maxDevices: number;
      activeDevices: number;
      status: string;
      expiresAt: string | null;
      createdAt: string;
    }>
  > {
    const list: Array<{
      id: string;
      planName: string;
      planType: "lifetime" | "annual" | "monthly";
      maxDevices: number;
      activeDevices: number;
      status: string;
      expiresAt: string | null;
      createdAt: string;
    }> = [];

    const userLicenses: LicenseRecord[] = [];
    if (this.db?.connected) {
      const res = await this.db.query<LicenseRecord>(
        "SELECT * FROM licenses WHERE user_id = $1",
        [userId]
      );
      userLicenses.push(...res.rows);
    } else {
      for (const lic of this.memoryLicenses.values()) {
        if (lic.user_id === userId) {
          userLicenses.push(lic);
        }
      }
    }

    for (const lic of userLicenses) {
      const plan = this.memoryPlans.get(lic.plan_id) ?? {
        id: lic.plan_id,
        name: "Standard",
        plan_type: "lifetime" as const,
        max_devices: 3,
        price_minor: 0,
        duration_days: null,
      };
      const activations = await this.getActiveActivations(lic.id);
      list.push({
        id: lic.id,
        planName: plan.name,
        planType: plan.plan_type,
        maxDevices: plan.max_devices,
        activeDevices: activations.length,
        status: lic.status,
        expiresAt: lic.expires_at,
        createdAt: lic.created_at,
      });
    }

    return list;
  }

  async getDevicesForUser(userId: string): Promise<DeviceRecord[]> {
    if (this.db?.connected) {
      const res = await this.db.query<DeviceRecord>(
        "SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen_at DESC",
        [userId]
      );
      return res.rows;
    }
    const result: DeviceRecord[] = [];
    for (const d of this.memoryDevices.values()) {
      if (d.user_id === userId) {
        result.push(d);
      }
    }
    return result;
  }

  async deactivateDeviceById(userId: string, deviceId: string): Promise<boolean> {
    if (this.db?.connected) {
      await this.db.query(
        "UPDATE license_activations SET status = 'revoked', revoked_at = NOW() WHERE device_id = $1",
        [deviceId]
      );
      return true;
    }
    for (const act of this.memoryActivations.values()) {
      if (act.device_id === deviceId) {
        act.status = "revoked";
        act.revoked_at = new Date().toISOString();
      }
    }
    return true;
  }

  private async findDeviceByUuid(deviceUuid: string): Promise<DeviceRecord | null> {
    if (this.db?.connected) {
      const res = await this.db.query<DeviceRecord>(
        "SELECT * FROM devices WHERE device_uuid = $1 LIMIT 1",
        [deviceUuid]
      );
      return res.rows[0] ?? null;
    }
    for (const d of this.memoryDevices.values()) {
      if (d.device_uuid === deviceUuid) return d;
    }
    return null;
  }

  private async getActiveActivations(licenseId: string): Promise<ActivationRecord[]> {
    if (this.db?.connected) {
      const res = await this.db.query<ActivationRecord>(
        "SELECT * FROM license_activations WHERE license_id = $1 AND status = 'active'",
        [licenseId]
      );
      return res.rows;
    }
    const result: ActivationRecord[] = [];
    for (const a of this.memoryActivations.values()) {
      if (a.license_id === licenseId && a.status === "active") {
        result.push(a);
      }
    }
    return result;
  }
}

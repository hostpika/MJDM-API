import * as crypto from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";
import { DatabaseService } from "../database/database.service";
import { AppSettingsService } from "./app-settings.service";

export const DEFAULT_TRIAL_DAYS = 30;
const MAX_TRIAL_DAYS = 365;

export interface TrialInfo {
  /** When this computer's trial began (server time). */
  startedAt: string;
  trialDays: number;
  /** startedAt + trialDays, using today's trial length. */
  endsAt: string;
  /** The server's clock, so the app can ignore a wrong or rolled-back local clock. */
  serverNow: string;
}

/**
 * The free trial. The server remembers when each computer first asked for it, so deleting the app's
 * data or reinstalling does not restart the clock. The length is set by an admin and applies to
 * everyone, including trials already running.
 */
@Injectable()
export class TrialsService {
  private readonly memory = new Map<string, string>();

  constructor(
    private readonly settings: AppSettingsService,
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
    @Optional() private readonly config?: AppConfigService
  ) {}

  private get pepper(): string {
    return (
      this.config?.get("SERVER_PEPPER") ?? process.env.SERVER_PEPPER ?? "mjdm_server_pepper_for_license_hmac_32_chars_min!"
    );
  }

  async trialDays(): Promise<number> {
    const s = await this.settings.get<{ trialDays?: number }>("app");
    const n = s?.trialDays;
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_TRIAL_DAYS ? n : DEFAULT_TRIAL_DAYS;
  }

  async setTrialDays(days: number, by: string): Promise<number> {
    const clean = Math.min(MAX_TRIAL_DAYS, Math.max(0, Math.floor(days)));
    const s = (await this.settings.get<Record<string, unknown>>("app")) ?? {};
    await this.settings.set("app", { ...s, trialDays: clean }, by);
    return clean;
  }

  /** Same computer, same hash: the machine id when the app sends one, else its install id. */
  private hash(deviceUuid: string, machineId?: string): string {
    return crypto
      .createHmac("sha256", this.pepper)
      .update(`trial:${machineId?.trim() || deviceUuid}`)
      .digest("hex");
  }

  async start(input: { deviceUuid: string; machineId?: string; platform?: string; appVersion?: string }): Promise<TrialInfo> {
    const h = this.hash(input.deviceUuid, input.machineId);
    const nowIso = new Date().toISOString();
    let startedAt: string;
    if (this.db?.connected) {
      const res = await this.db.query<{ started_at: string }>(
        `INSERT INTO trials (device_hash, platform, app_version) VALUES ($1, $2, $3)
         ON CONFLICT (device_hash) DO UPDATE SET last_seen_at = NOW(), app_version = EXCLUDED.app_version
         RETURNING started_at`,
        [h, input.platform ?? null, input.appVersion ?? null]
      );
      startedAt = new Date(res.rows[0].started_at).toISOString();
    } else {
      startedAt = this.memory.get(h) ?? nowIso;
      this.memory.set(h, startedAt);
    }
    return this.info(startedAt, nowIso);
  }

  async info(startedAt: string, nowIso = new Date().toISOString()): Promise<TrialInfo> {
    const days = await this.trialDays();
    return {
      startedAt,
      trialDays: days,
      endsAt: new Date(new Date(startedAt).getTime() + days * 86_400_000).toISOString(),
      serverNow: nowIso,
    };
  }
}

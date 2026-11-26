import * as fs from "node:fs";
import * as path from "node:path";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";

/**
 * Small admin-editable settings (trial length, the SMTP account). PostgreSQL when connected,
 * otherwise a JSON file (APP_SETTINGS_FILE, default ./data/app-settings.json).
 */
@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);
  private readonly cache = new Map<string, unknown>();

  constructor(@Optional() @Inject(DatabaseService) private readonly db?: DatabaseService) {}

  private get file(): string {
    return path.resolve(process.env.APP_SETTINGS_FILE ?? "data/app-settings.json");
  }

  private readFile(): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf-8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    let value: unknown = null;
    if (this.db?.connected) {
      try {
        const res = await this.db.query<{ value: unknown }>("SELECT value FROM app_settings WHERE key = $1", [key]);
        value = res.rows[0]?.value ?? null;
      } catch (err) {
        this.logger.warn(`Could not read setting ${key}: ${String(err)}`);
      }
    } else {
      value = this.readFile()[key] ?? null;
    }
    this.cache.set(key, value);
    return value as T | null;
  }

  async set(key: string, value: unknown, by: string): Promise<void> {
    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW(), updated_by = $3`,
        [key, JSON.stringify(value), by]
      );
    } else {
      const all = this.readFile();
      all[key] = value;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(all, null, 2), "utf-8");
      fs.renameSync(tmp, this.file);
    }
    this.cache.set(key, value);
  }
}

import * as fs from "node:fs";
import * as path from "node:path";
import { BadRequestException, Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { DEFAULT_SITE_CONTENT, type SiteContent, siteContentSchema } from "./site-content.schema";

export interface StoredSiteContent {
  content: SiteContent;
  updatedAt: string | null;
  updatedBy: string | null;
}

const KEY = "site";

/**
 * The website's editable content. Stored in PostgreSQL when connected, otherwise in a JSON file
 * (SITE_CONTENT_FILE, default ./data/site-content.json) so edits survive a restart even without a
 * database. Always validated; an invalid stored document falls back to the defaults.
 */
@Injectable()
export class SiteContentService {
  private readonly logger = new Logger(SiteContentService.name);
  private readonly file = path.resolve(process.env.SITE_CONTENT_FILE ?? "data/site-content.json");
  private cache: StoredSiteContent | null = null;

  constructor(@Optional() @Inject(DatabaseService) private readonly db?: DatabaseService) {}

  async get(): Promise<StoredSiteContent> {
    if (this.cache) return this.cache;
    const stored = (await this.readDb()) ?? this.readFile();
    this.cache = stored ?? { content: DEFAULT_SITE_CONTENT, updatedAt: null, updatedBy: null };
    return this.cache;
  }

  async set(input: unknown, adminEmail: string): Promise<StoredSiteContent> {
    const parsed = siteContentSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid site content",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const stored: StoredSiteContent = {
      content: parsed.data,
      updatedAt: new Date().toISOString(),
      updatedBy: adminEmail,
    };
    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO site_content (key, value, updated_at, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = $3, updated_by = $4`,
        [KEY, JSON.stringify(parsed.data), stored.updatedAt, adminEmail]
      );
    } else {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), "utf-8");
      fs.renameSync(tmp, this.file);
    }
    this.cache = stored;
    return stored;
  }

  private async readDb(): Promise<StoredSiteContent | null> {
    if (!this.db?.connected) return null;
    try {
      const res = await this.db.query<{ value: unknown; updated_at: string; updated_by: string }>(
        "SELECT value, updated_at, updated_by FROM site_content WHERE key = $1",
        [KEY]
      );
      const row = res.rows[0];
      if (!row) return null;
      return this.validated(row.value, String(row.updated_at), row.updated_by);
    } catch (err) {
      this.logger.warn(`Could not read site content from the database: ${String(err)}`);
      return null;
    }
  }

  private readFile(): StoredSiteContent | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf-8")) as StoredSiteContent;
      return this.validated(raw.content, raw.updatedAt, raw.updatedBy);
    } catch {
      return null;
    }
  }

  private validated(value: unknown, at: string | null, by: string | null): StoredSiteContent | null {
    const parsed = siteContentSchema.safeParse(value);
    if (!parsed.success) {
      this.logger.warn("Stored site content failed validation; using defaults");
      return null;
    }
    return { content: parsed.data, updatedAt: at, updatedBy: by };
  }
}

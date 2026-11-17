import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { validateEnv } from "../config/env.schema";

export interface MigrationFile {
  name: string;
  filePath: string;
  sql: string;
}

export function loadMigrations(migrationsDir?: string): MigrationFile[] {
  const dir = migrationsDir ?? path.join(__dirname, "migrations");
  if (!fs.existsSync(dir)) {
    return [];
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((file) => ({
    name: file,
    filePath: path.join(dir, file),
    sql: fs.readFileSync(path.join(dir, file), "utf-8"),
  }));
}

export async function runMigrations(
  databaseUrl?: string,
  migrationsDir?: string
): Promise<{ applied: string[]; skipped: string[] }> {
  const migrations = loadMigrations(migrationsDir);
  const applied: string[] = [];
  const skipped: string[] = [];

  const dbUrl = databaseUrl ?? validateEnv().DATABASE_URL;

  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 3000,
  });

  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const { rows } = await client.query<{ name: string }>(
        "SELECT name FROM _migrations"
      );
      const appliedSet = new Set(rows.map((r) => r.name));

      for (const mig of migrations) {
        if (appliedSet.has(mig.name)) {
          skipped.push(mig.name);
          continue;
        }

        await client.query("BEGIN");
        try {
          await client.query(mig.sql);
          await client.query(
            "INSERT INTO _migrations (name) VALUES ($1)",
            [mig.name]
          );
          await client.query("COMMIT");
          applied.push(mig.name);
        } catch (err) {
          await client.query("ROLLBACK");
          throw new Error(`Failed to apply migration ${mig.name}: ${err}`);
        }
      }
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Migrator] Database connection failed or migration skipped: ${msg}`);
  } finally {
    await pool.end().catch(() => {});
  }

  return { applied, skipped };
}

if (require.main === module) {
  runMigrations()
    .then((res) => {
      console.log(`[Migrator] Applied: ${res.applied.join(", ") || "none"}`);
      console.log(`[Migrator] Skipped: ${res.skipped.join(", ") || "none"}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Migrator] Fatal error:", err);
      process.exit(1);
    });
}

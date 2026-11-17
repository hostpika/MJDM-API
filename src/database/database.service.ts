import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { AppConfigService } from "../config/config.service";

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private isConnected = false;

  constructor(
    @Optional()
    @Inject(AppConfigService)
    private readonly config?: AppConfigService
  ) {}

  async onModuleInit(): Promise<void> {
    const dbUrl =
      this.config?.get("DATABASE_URL") ??
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/mjdm_cloud";

    try {
      this.pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 5000,
        max: 10,
      });

      // Quick test
      const client = await this.pool.connect();
      client.release();
      this.isConnected = true;
      this.logger.log("Connected to PostgreSQL database successfully.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`PostgreSQL connection not established (${msg}). Operating in standalone/mock mode.`);
      this.isConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ): Promise<QueryResult<T>> {
    if (!this.pool || !this.isConnected) {
      // Mock result when offline
      return {
        rows: [] as unknown as T[],
        command: "SELECT",
        rowCount: 0,
        oid: 0,
        fields: [],
      };
    }
    return this.pool.query<T>(sql, params);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool || !this.isConnected) {
      throw new Error("Cannot execute transaction: database is not connected");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  PullSyncDto,
  PushSyncDto,
  SetupSyncDto,
  SyncRecordDto,
} from "./dto/sync.dto";

export interface SyncAccountData {
  userId: string;
  kdfParams: object;
  wrappedMk: string;
  wrappedMkRecovery: string;
  createdAt: string;
}

export interface StoredSyncRecord {
  userId: string;
  collection: string;
  recordId: string;
  serverSeq: number;
  hlc: string;
  deviceTag: string;
  deleted: boolean;
  schemaVersion: number;
  blob: string;
  blobBytes: number;
  updatedAt: string;
}

export interface SyncStatus {
  configured: boolean;
  recordCount: number;
  totalBytes: number;
  quotaRecords: number;
  quotaBytes: number;
  maxServerSeq: number;
}

export const MAX_RECORD_SIZE_BYTES = 64 * 1024; // 64 KiB
export const MAX_ACCOUNT_RECORDS = 20_000;
export const MAX_ACCOUNT_STORAGE_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_PULL_LIMIT = 500;
export const MAX_PAGE_BYTES = 1024 * 1024; // 1 MiB

@Injectable()
export class SyncService {
  private inMemoryAccounts = new Map<string, SyncAccountData>();
  private inMemoryRecords = new Map<string, Map<string, StoredSyncRecord>>(); // userId -> (key -> record)
  private sequenceCounter = 1;

  constructor(
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService
  ) {}

  async setup(userId: string, dto: SetupSyncDto): Promise<{ success: boolean }> {
    if (this.db?.connected) {
      await this.db.query(
        `INSERT INTO sync_accounts (user_id, kdf_params, wrapped_mk, wrapped_mk_recovery)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           kdf_params = EXCLUDED.kdf_params,
           wrapped_mk = EXCLUDED.wrapped_mk,
           wrapped_mk_recovery = EXCLUDED.wrapped_mk_recovery`,
        [
          userId,
          JSON.stringify(dto.kdf_params),
          Buffer.from(dto.wrapped_mk, "base64"),
          Buffer.from(dto.wrapped_mk_recovery, "base64"),
        ]
      );
    }

    this.inMemoryAccounts.set(userId, {
      userId,
      kdfParams: dto.kdf_params,
      wrappedMk: dto.wrapped_mk,
      wrappedMkRecovery: dto.wrapped_mk_recovery,
      createdAt: new Date().toISOString(),
    });

    return { success: true };
  }

  async getSetup(userId: string): Promise<{
    configured: boolean;
    kdf_params?: object;
    wrapped_mk?: string;
    wrapped_mk_recovery?: string;
  }> {
    if (this.db?.connected) {
      const res = await this.db.query(
        "SELECT kdf_params, wrapped_mk, wrapped_mk_recovery FROM sync_accounts WHERE user_id = $1",
        [userId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          configured: true,
          kdf_params: typeof row.kdf_params === "string" ? JSON.parse(row.kdf_params) : row.kdf_params,
          wrapped_mk: Buffer.from(row.wrapped_mk).toString("base64"),
          wrapped_mk_recovery: Buffer.from(row.wrapped_mk_recovery).toString("base64"),
        };
      }
    }

    const mem = this.inMemoryAccounts.get(userId);
    if (mem) {
      return {
        configured: true,
        kdf_params: mem.kdfParams,
        wrapped_mk: mem.wrappedMk,
        wrapped_mk_recovery: mem.wrappedMkRecovery,
      };
    }

    return { configured: false };
  }

  async push(
    userId: string,
    dto: PushSyncDto
  ): Promise<{ accepted: number; rejected: number; currentSeq: number }> {
    let accepted = 0;
    let rejected = 0;

    let userRecords = this.inMemoryRecords.get(userId);
    if (!userRecords) {
      userRecords = new Map();
      this.inMemoryRecords.set(userId, userRecords);
    }

    for (const record of dto.records) {
      const blobBuffer = Buffer.from(record.blob, "base64");
      const blobBytes = blobBuffer.length;

      // 1. Enforce individual record size cap
      if (blobBytes > MAX_RECORD_SIZE_BYTES) {
        throw new BadRequestException(
          `Record ${record.record_id} exceeds max blob size of 64 KiB (was ${blobBytes} bytes)`
        );
      }

      const key = `${record.collection}:${record.record_id}`;
      const existing = userRecords.get(key);

      // 2. Check total account quotas if inserting new record
      if (!existing) {
        if (userRecords.size >= MAX_ACCOUNT_RECORDS) {
          throw new BadRequestException(
            `Account sync limit of ${MAX_ACCOUNT_RECORDS} records exceeded`
          );
        }

        const currentTotalBytes = Array.from(userRecords.values()).reduce(
          (acc, r) => acc + r.blobBytes,
          0
        );
        if (currentTotalBytes + blobBytes > MAX_ACCOUNT_STORAGE_BYTES) {
          throw new BadRequestException(
            `Account sync storage quota of 5 MiB exceeded`
          );
        }
      }

      // 3. LWW Conflict Resolution Check
      if (existing) {
        if (record.hlc < existing.hlc) {
          // Incoming is older than existing record -> reject / keep local
          rejected++;
          continue;
        } else if (record.hlc === existing.hlc) {
          // Tie-break: if identical, idempotent noop; if incoming blob is not greater, ignore
          if (
            record.deleted === existing.deleted &&
            record.blob === existing.blob &&
            record.schema_version === existing.schemaVersion
          ) {
            accepted++;
            continue;
          } else if (record.blob <= existing.blob) {
            rejected++;
            continue;
          }
        }
      }

      // 4. Accept change and assign next server_seq
      const serverSeq = ++this.sequenceCounter;
      const stored: StoredSyncRecord = {
        userId,
        collection: record.collection,
        recordId: record.record_id,
        serverSeq,
        hlc: record.hlc,
        deviceTag: record.device_tag,
        deleted: record.deleted,
        schemaVersion: record.schema_version,
        blob: record.blob,
        blobBytes,
        updatedAt: new Date().toISOString(),
      };

      userRecords.set(key, stored);

      if (this.db?.connected) {
        await this.db.query(
          `INSERT INTO sync_records (user_id, collection, record_id, server_seq, hlc, device_tag, deleted, schema_version, blob)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (user_id, collection, record_id) DO UPDATE SET
             server_seq = EXCLUDED.server_seq,
             hlc = EXCLUDED.hlc,
             device_tag = EXCLUDED.device_tag,
             deleted = EXCLUDED.deleted,
             schema_version = EXCLUDED.schema_version,
             blob = EXCLUDED.blob,
             updated_at = NOW()`,
          [
            userId,
            record.collection,
            record.record_id,
            serverSeq,
            1, // integer hlc representation or reference
            record.device_tag,
            record.deleted,
            record.schema_version,
            blobBuffer,
          ]
        );
      }

      accepted++;
    }

    return {
      accepted,
      rejected,
      currentSeq: this.sequenceCounter,
    };
  }

  async pull(
    userId: string,
    dto: PullSyncDto
  ): Promise<{ records: SyncRecordDto[]; cursor: number; has_more: boolean }> {
    const cursor = dto.cursor ?? 0;
    const limit = Math.min(dto.limit ?? MAX_PULL_LIMIT, MAX_PULL_LIMIT);
    const collectionsFilter = dto.collections
      ? new Set(dto.collections)
      : null;

    let userRecords = this.inMemoryRecords.get(userId);
    const candidateRecords: StoredSyncRecord[] = [];

    if (userRecords) {
      for (const rec of userRecords.values()) {
        if (rec.serverSeq > cursor) {
          if (!collectionsFilter || collectionsFilter.has(rec.collection)) {
            candidateRecords.push(rec);
          }
        }
      }
    }

    candidateRecords.sort((a, b) => a.serverSeq - b.serverSeq);

    const resultRecords: SyncRecordDto[] = [];
    let cumulativeBytes = 0;
    let nextCursor = cursor;
    let hasMore = false;

    for (let i = 0; i < candidateRecords.length; i++) {
      const rec = candidateRecords[i];
      if (resultRecords.length >= limit) {
        hasMore = true;
        break;
      }

      if (
        resultRecords.length > 0 &&
        cumulativeBytes + rec.blobBytes > MAX_PAGE_BYTES
      ) {
        hasMore = true;
        break;
      }

      resultRecords.push({
        collection: rec.collection,
        record_id: rec.recordId,
        hlc: rec.hlc,
        device_tag: rec.deviceTag,
        deleted: rec.deleted,
        schema_version: rec.schemaVersion,
        blob: rec.blob,
      });

      cumulativeBytes += rec.blobBytes;
      nextCursor = rec.serverSeq;
    }

    if (candidateRecords.length > resultRecords.length) {
      hasMore = true;
    }

    return {
      records: resultRecords,
      cursor: nextCursor,
      has_more: hasMore,
    };
  }

  async getStatus(userId: string): Promise<SyncStatus> {
    const configured = this.inMemoryAccounts.has(userId);
    const userRecords = this.inMemoryRecords.get(userId);

    const recordCount = userRecords?.size ?? 0;
    let totalBytes = 0;
    let maxServerSeq = 0;

    if (userRecords) {
      for (const rec of userRecords.values()) {
        totalBytes += rec.blobBytes;
        if (rec.serverSeq > maxServerSeq) {
          maxServerSeq = rec.serverSeq;
        }
      }
    }

    return {
      configured,
      recordCount,
      totalBytes,
      quotaRecords: MAX_ACCOUNT_RECORDS,
      quotaBytes: MAX_ACCOUNT_STORAGE_BYTES,
      maxServerSeq,
    };
  }

  async deleteSync(
    userId: string
  ): Promise<{ success: boolean; deleted_records: number }> {
    const userRecords = this.inMemoryRecords.get(userId);
    const count = userRecords?.size ?? 0;

    this.inMemoryRecords.delete(userId);
    this.inMemoryAccounts.delete(userId);

    if (this.db?.connected) {
      await this.db.query("DELETE FROM sync_records WHERE user_id = $1", [userId]);
      await this.db.query("DELETE FROM sync_accounts WHERE user_id = $1", [userId]);
    }

    return {
      success: true,
      deleted_records: count,
    };
  }
}

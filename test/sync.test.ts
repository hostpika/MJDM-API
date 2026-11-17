import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { SyncService, MAX_RECORD_SIZE_BYTES } from "../src/sync/sync.service";
import { SetupSyncDto, PushSyncDto, PullSyncDto } from "../src/sync/dto/sync.dto";

describe("P11-T03: E2EE Sync API, Storage & Quotas Suite", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440000";

  it("should configure and retrieve E2EE sync account credentials", async () => {
    const service = new SyncService();
    const setupDto: SetupSyncDto = {
      kdf_params: {
        alg: "argon2id",
        m: 65536,
        t: 3,
        p: 4,
        salt: "c2FsdF9leGFtcGxlXzE2",
      },
      wrapped_mk: "d3JhcHBlZF9tYXN0ZXJfa2V5X2Jsb2JfMjU2Yml0",
      wrapped_mk_recovery: "d3JhcHBlZF9tYXN0ZXJfa2V5X3JlY292ZXJ5X2Jsb2I=",
    };

    const res = await service.setup(userId, setupDto);
    expect(res.success).toBe(true);

    const info = await service.getSetup(userId);
    expect(info.configured).toBe(true);
    expect(info.wrapped_mk).toBe(setupDto.wrapped_mk);
    expect(info.wrapped_mk_recovery).toBe(setupDto.wrapped_mk_recovery);
  });

  it("should enforce individual record 64 KiB quota limit", async () => {
    const service = new SyncService();

    // Oversized blob (> 64 KiB = 65,536 bytes)
    const oversizedBuffer = Buffer.alloc(MAX_RECORD_SIZE_BYTES + 1, "A");
    const pushDto: PushSyncDto = {
      records: [
        {
          collection: "settings",
          record_id: "a0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10000:0001:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: oversizedBuffer.toString("base64"),
        },
      ],
    };

    await expect(service.push(userId, pushDto)).rejects.toThrow(BadRequestException);
  });

  it("should handle push, LWW conflict resolution, and idempotent repeats", async () => {
    const service = new SyncService();

    // Initial push with HLC 100
    const push1: PushSyncDto = {
      records: [
        {
          collection: "categories",
          record_id: "c0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10100:0000:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("ciphertext_v1").toString("base64"),
        },
      ],
    };

    const res1 = await service.push(userId, push1);
    expect(res1.accepted).toBe(1);
    expect(res1.rejected).toBe(0);

    // Idempotent repeat with exact same HLC & blob
    const resRepeat = await service.push(userId, push1);
    expect(resRepeat.accepted).toBe(1);
    expect(resRepeat.rejected).toBe(0);

    // Stale push with older HLC 050 -> rejected
    const pushStale: PushSyncDto = {
      records: [
        {
          collection: "categories",
          record_id: "c0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10050:0000:dev-2",
          device_tag: "dev-2",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("ciphertext_stale").toString("base64"),
        },
      ],
    };

    const resStale = await service.push(userId, pushStale);
    expect(resStale.accepted).toBe(0);
    expect(resStale.rejected).toBe(1);

    // Newer push with HLC 200 -> accepted and overwrites
    const pushNew: PushSyncDto = {
      records: [
        {
          collection: "categories",
          record_id: "c0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10200:0000:dev-2",
          device_tag: "dev-2",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("ciphertext_v2").toString("base64"),
        },
      ],
    };

    const resNew = await service.push(userId, pushNew);
    expect(resNew.accepted).toBe(1);
    expect(resNew.rejected).toBe(0);

    // Verify stored state
    const pulled = await service.pull(userId, { cursor: 0 });
    expect(pulled.records.length).toBe(1);
    expect(pulled.records[0].blob).toBe(Buffer.from("ciphertext_v2").toString("base64"));
  });

  it("should support cursor pagination and collection filtering on pull", async () => {
    const service = new SyncService();

    // Push 3 records across 2 collections
    await service.push(userId, {
      records: [
        {
          collection: "settings",
          record_id: "s0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10001:0000:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("settings_blob").toString("base64"),
        },
        {
          collection: "queues_rules",
          record_id: "q0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10002:0000:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("queue_blob_1").toString("base64"),
        },
        {
          collection: "queues_rules",
          record_id: "q0000000-0000-0000-0000-000000000002",
          hlc: "0000018c10003:0000:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("queue_blob_2").toString("base64"),
        },
      ],
    });

    // 1. Pull with collection filter
    const queuesOnly = await service.pull(userId, {
      collections: ["queues_rules"],
    });
    expect(queuesOnly.records.length).toBe(2);
    expect(queuesOnly.records.every((r) => r.collection === "queues_rules")).toBe(true);

    // 2. Cursor pagination with limit = 1
    const page1 = await service.pull(userId, { limit: 1 });
    expect(page1.records.length).toBe(1);
    expect(page1.has_more).toBe(true);

    const page2 = await service.pull(userId, { cursor: page1.cursor, limit: 1 });
    expect(page2.records.length).toBe(1);
    expect(page2.cursor).toBeGreaterThan(page1.cursor);
  });

  it("should report status and purge all data upon deleteSync", async () => {
    const service = new SyncService();

    await service.setup(userId, {
      kdf_params: { alg: "argon2id", m: 65536, t: 3, p: 4, salt: "salt" },
      wrapped_mk: "wrapped_mk",
      wrapped_mk_recovery: "recovery",
    });

    await service.push(userId, {
      records: [
        {
          collection: "site_profiles",
          record_id: "p0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10001:0000:dev-1",
          device_tag: "dev-1",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("profile_blob").toString("base64"),
        },
      ],
    });

    const status = await service.getStatus(userId);
    expect(status.configured).toBe(true);
    expect(status.recordCount).toBe(1);
    expect(status.totalBytes).toBeGreaterThan(0);

    // Purge data
    const del = await service.deleteSync(userId);
    expect(del.success).toBe(true);
    expect(del.deleted_records).toBe(1);

    const afterStatus = await service.getStatus(userId);
    expect(afterStatus.configured).toBe(false);
    expect(afterStatus.recordCount).toBe(0);
    expect(afterStatus.totalBytes).toBe(0);
  });
});

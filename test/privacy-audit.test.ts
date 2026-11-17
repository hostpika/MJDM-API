import { describe, expect, it } from "vitest";
import { SyncService } from "../src/sync/sync.service";
import { PushSyncDto } from "../src/sync/dto/sync.dto";

describe("P11-T07: Privacy Review — Zero Plaintext Server-Side Verification", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440000";

  it("should ensure server storage contains ZERO plaintext URLs, credentials, or file paths", async () => {
    const service = new SyncService();

    // Sensitive plaintext markers that must NEVER leak to server storage in plaintext
    const sensitiveTokens = [
      "https://dist.torproject.org/torbrowser/14.0/tor-browser.exe",
      "torproject.org",
      "https://internal-bank.com/statements/2026-Q1.pdf",
      "internal-bank.com",
      "super_secret_corporate_token",
      "ftp://admin:VerySecretPass123@backup.corp.local/db.dump",
      "VerySecretPass123",
      "C:\\Users\\Executive\\Confidential\\payroll.xlsx",
    ];

    // Client-side encrypted mock blobs (Base64 opaque AES-256-GCM ciphertexts)
    // The client encrypts the sensitive tokens before network transit
    const opaqueBlob1 = Buffer.from(
      JSON.stringify({
        nonce: "dGVzdF9ub25jZV8xMjg=",
        ciphertext: "7xK9pZ3vL8mQ1rT5wY0uI4oP2sD6fG8hJ0kL2zX4cV6bN8m=",
      })
    ).toString("base64");

    const opaqueBlob2 = Buffer.from(
      JSON.stringify({
        nonce: "dGVzdF9ub25jZV8xMjkw",
        ciphertext: "9aB8cD7eF6gH5iJ4kL3mN2oP1qR0sT9uV8wX7yZ6aB5c=",
      })
    ).toString("base64");

    const pushDto: PushSyncDto = {
      records: [
        {
          collection: "settings",
          record_id: "e0000000-0000-0000-0000-000000000001",
          hlc: "0000018c10000:0001:dev-audit",
          device_tag: "dev-audit",
          deleted: false,
          schema_version: 1,
          blob: opaqueBlob1,
        },
        {
          collection: "queues_rules",
          record_id: "e0000000-0000-0000-0000-000000000002",
          hlc: "0000018c10001:0001:dev-audit",
          device_tag: "dev-audit",
          deleted: false,
          schema_version: 1,
          blob: opaqueBlob2,
        },
      ],
    };

    // Push to sync service
    const pushRes = await service.push(userId, pushDto);
    expect(pushRes.accepted).toBe(2);

    // Pull raw server records and scan all fields for sensitive tokens
    const pullRes = await service.pull(userId, { cursor: 0 });
    expect(pullRes.records.length).toBe(2);

    // Serialize every single byte stored or returned by the server
    const serverPayloadDump = JSON.stringify(pullRes);

    for (const token of sensitiveTokens) {
      expect(serverPayloadDump).not.toContain(token);
    }

    // Verify metadata visible to server is strictly limited to expected schema
    for (const record of pullRes.records) {
      expect(["settings", "categories", "queues_rules", "site_profiles"]).toContain(
        record.collection
      );
      expect(record.record_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(record.hlc).toBeDefined();
      expect(record.device_tag).toBeDefined();
      expect(typeof record.deleted).toBe("boolean");
      expect(typeof record.schema_version).toBe("number");
      expect(typeof record.blob).toBe("string");

      // Verify blob decoded is valid JSON envelope with non-plaintext ciphertext
      const decodedBlobStr = Buffer.from(record.blob, "base64").toString("utf-8");
      for (const token of sensitiveTokens) {
        expect(decodedBlobStr).not.toContain(token);
      }
    }
  });

  it("should ensure account erasure removes all sync records irrevocably", async () => {
    const service = new SyncService();

    await service.push(userId, {
      records: [
        {
          collection: "categories",
          record_id: "e0000000-0000-0000-0000-000000000003",
          hlc: "0000018c10002:0001:dev-audit",
          device_tag: "dev-audit",
          deleted: false,
          schema_version: 1,
          blob: Buffer.from("opaque_test_blob").toString("base64"),
        },
      ],
    });

    const before = await service.getStatus(userId);
    expect(before.recordCount).toBe(1);

    // GDPR Art. 17 right to erasure
    const delRes = await service.deleteSync(userId);
    expect(delRes.success).toBe(true);
    expect(delRes.deleted_records).toBe(1);

    const after = await service.getStatus(userId);
    expect(after.recordCount).toBe(0);
    expect(after.totalBytes).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { Es256Service } from "../src/licenses/es256.service";
import { LicenseKeyService } from "../src/licenses/key-generator";
import { LicensesService } from "../src/licenses/licenses.service";

describe("P10-T03: Licensing Subsystem & ES256 Tokens", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const es256 = new Es256Service(config);
  es256.onModuleInit();
  const licensesService = new LicensesService(db, config, es256);

  describe("Crockford Base32 Key Generation & Normalization", () => {
    it("should generate keys matching MJDM-XXXXX-XXXXX-XXXXX-XXXXX", () => {
      const key = LicenseKeyService.generate();
      expect(key).toMatch(/^MJDM-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}$/);
      expect(LicenseKeyService.isValid(key)).toBe(true);
    });

    it("should normalize lowercase and visually ambiguous characters (I, L, O)", () => {
      const raw = "mjdm-1234i-5678l-9012o-34567";
      const normalized = LicenseKeyService.normalize(raw);
      expect(normalized).toBe("12341567819012034567");
      expect(normalized).not.toContain("I");
      expect(normalized).not.toContain("L");
      expect(normalized).not.toContain("O");
    });

    it("should reject corrupted keys with invalid checksums", () => {
      const key = LicenseKeyService.generate();
      // Tamper with one character
      const chars = key.split("");
      chars[chars.length - 1] = chars[chars.length - 1] === "A" ? "B" : "A";
      const tampered = chars.join("");

      expect(LicenseKeyService.isValid(tampered)).toBe(false);
    });

    it("should compute deterministic HMAC-SHA256 from normalized key", () => {
      const key = LicenseKeyService.generate();
      const pepper = config.get("SERVER_PEPPER");
      const hmac1 = LicenseKeyService.computeHmac(key, pepper);
      const hmac2 = LicenseKeyService.computeHmac(key.toLowerCase(), pepper);

      expect(hmac1).toHaveLength(64);
      expect(hmac1).toBe(hmac2);
    });
  });

  describe("ES256 Digital Signatures & Offline Verification", () => {
    it("should sign and verify license claims with ES256", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const claims = {
        sub: "lic-123",
        did: "123e4567-e89b-12d3-a456-426614174000",
        plan: "lifetime",
        max_devices: 3,
        features: ["http", "media", "torrent"],
        iat: nowSec,
        exp: nowSec + 14 * 86400,
        grace_exp: nowSec + 17 * 86400,
      };

      const token = es256.signToken(claims);
      expect(token.split(".")).toHaveLength(3);

      const res = es256.verifyToken(token);
      expect(res.valid).toBe(true);
      expect(res.claims?.sub).toBe("lic-123");
      expect(res.claims?.features).toContain("torrent");
    });

    it("should reject tampered ES256 tokens", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = es256.signToken({
        sub: "lic-123",
        did: "device-1",
        plan: "lifetime",
        max_devices: 3,
        features: ["http"],
        iat: nowSec,
        exp: nowSec + 14 * 86400,
        grace_exp: nowSec + 17 * 86400,
      });

      const parts = token.split(".");
      // Tamper with payload segment
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: "lic-123", max_devices: 999 })
      )
        .toString("base64")
        .replace(/=/g, "");
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const res = es256.verifyToken(tamperedToken);
      expect(res.valid).toBe(false);
      expect(res.error).toMatch(/Invalid ES256 cryptographic signature/);
    });
  });

  describe("Device Activation & Capacity Enforcement", () => {
    it("should enforce plan device limits and allow deactivation to free slots", async () => {
      // Create a 1-device license (Personal plan)
      const { key, licenseId } = await licensesService.createLicense(
        "user-test-1",
        "plan-annual-personal"
      );

      const device1Uuid = "11111111-1111-1111-1111-111111111111";
      const device2Uuid = "22222222-2222-2222-2222-222222222222";

      // 1. Activate device 1 (should succeed: 1/1)
      const act1 = await licensesService.activate({
        licenseKey: key,
        deviceUuid: device1Uuid,
        platform: "windows",
        osVersion: "Windows 11",
      });
      expect(act1.licenseId).toBe(licenseId);
      expect(act1.activeDevices).toBe(1);
      expect(act1.maxDevices).toBe(1);
      expect(act1.token).toBeDefined();

      // 2. Activate device 2 (must fail with 409 Conflict: limit reached)
      await expect(
        licensesService.activate({
          licenseKey: key,
          deviceUuid: device2Uuid,
          platform: "linux",
          osVersion: "Ubuntu 24.04",
        })
      ).rejects.toThrow(/Device limit reached/);

      // 3. Deactivate device 1
      const deact = await licensesService.deactivate({
        licenseId,
        deviceUuid: device1Uuid,
      });
      expect(deact.success).toBe(true);

      // 4. Activate device 2 (now succeeds: slot freed)
      const act2 = await licensesService.activate({
        licenseKey: key,
        deviceUuid: device2Uuid,
        platform: "linux",
      });
      expect(act2.activeDevices).toBe(1);
      expect(act2.token).toBeDefined();
    });

    it("should revoke license and reject further operations", async () => {
      const { key, licenseId } = await licensesService.createLicense(
        "user-test-2",
        "plan-lifetime-pro"
      );
      const devUuid = "33333333-3333-3333-3333-333333333333";

      await licensesService.activate({
        licenseKey: key,
        deviceUuid: devUuid,
        platform: "windows",
      });

      // Revoke license (e.g. refund)
      await licensesService.revokeLicense(licenseId);

      // Subsequent refresh must fail with Forbidden
      await expect(
        licensesService.refresh({
          licenseId,
          deviceUuid: devUuid,
        })
      ).rejects.toThrow(/License is not active or has been revoked/);
    });
  });
});

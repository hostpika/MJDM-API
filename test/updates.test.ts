import { describe, expect, it } from "vitest";
import { UpdatesService } from "../src/updates/updates.service";

describe("P10-T06: Updates & Release Management", () => {
  const updatesService = new UpdatesService();

  describe("Version Check & Tauri Updater Response", () => {
    it("should return update manifest for older client versions", async () => {
      const res = await updatesService.checkUpdate(
        "windows",
        "x86_64",
        "0.7.0",
        "stable"
      );

      expect(res).not.toBeNull();
      expect(res?.version).toBe("0.8.0");
      expect(res?.url).toContain("mjdm-windows-x86_64-setup.exe");
      expect(res?.signature).toContain("minisign:");
      expect(res?.notes).toContain("Initial Beta Release");
      expect(res?.pub_date).toBeDefined();
    });

    it("should return null for clients already on the latest version", async () => {
      const res = await updatesService.checkUpdate(
        "windows",
        "x86_64",
        "0.8.0",
        "stable"
      );

      expect(res).toBeNull();
    });
  });

  describe("Channel Filtering (Stable vs Beta)", () => {
    it("should respect release channels: stable clients do not receive beta updates", async () => {
      // Publish a beta release v0.9.0-beta.1
      await updatesService.publishRelease({
        version: "0.9.0",
        platform: "windows",
        architecture: "x86_64",
        channel: "beta",
        isMandatory: false,
        releaseNotes: "Beta preview of new Torrent engine features",
        artifactUrl: "https://releases.mjdm.app/v0.9.0-beta/setup.exe",
        fileSize: 49000000,
        sha256: "aabbcc112233",
        signature: "minisign:beta_sig",
        rolloutPercentage: 100,
      });

      // 1. Stable channel client checking for update
      const stableRes = await updatesService.checkUpdate(
        "windows",
        "x86_64",
        "0.8.0",
        "stable"
      );
      // Should NOT receive the 0.9.0 beta update
      expect(stableRes).toBeNull();

      // 2. Beta channel client checking for update
      const betaRes = await updatesService.checkUpdate(
        "windows",
        "x86_64",
        "0.8.0",
        "beta"
      );
      // Should receive the 0.9.0 beta update
      expect(betaRes).not.toBeNull();
      expect(betaRes?.version).toBe("0.9.0");
    });
  });

  describe("Staged Rollouts & Cohort Bucketing", () => {
    it("should hold back updates from clients outside the rollout percentage cohort", async () => {
      // Publish a 20% staged rollout for Linux
      await updatesService.publishRelease({
        version: "1.0.0",
        platform: "linux",
        architecture: "x86_64",
        channel: "stable",
        isMandatory: false,
        releaseNotes: "v1.0.0 GA rollout",
        artifactUrl: "https://releases.mjdm.app/v1.0.0/mjdm-linux-x86_64.AppImage",
        fileSize: 52000000,
        sha256: "112233445566",
        rolloutPercentage: 20,
      });

      // Test multiple UUIDs: some will fall inside < 20, some will fall >= 20
      let insideCount = 0;
      let outsideCount = 0;

      for (let i = 0; i < 50; i++) {
        const testUuid = `test-client-device-${i}`;
        const res = await updatesService.checkUpdate(
          "linux",
          "x86_64",
          "0.8.0",
          "stable",
          testUuid
        );
        if (res !== null) {
          insideCount++;
        } else {
          outsideCount++;
        }
      }

      // In a 20% rollout across 50 clients, both cohorts must be non-zero
      expect(insideCount).toBeGreaterThan(0);
      expect(outsideCount).toBeGreaterThan(0);
      expect(outsideCount).toBeGreaterThan(insideCount);
    });
  });
});

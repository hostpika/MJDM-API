import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import { UpdatesService } from "../src/updates/updates.service";

describe("v1.0.0 GA Release Verification & Post-Launch Plan (P13-T07)", () => {
  const rootDir = path.resolve(__dirname, "..");

  it("verifies CHANGELOG.md documents v1.0.0 with full feature additions", () => {
    const changelogPath = path.join(rootDir, "CHANGELOG.md");
    expect(fs.existsSync(changelogPath)).toBe(true);

    const changelog = fs.readFileSync(changelogPath, "utf-8");
    expect(changelog).toContain("[1.0.0] - 2026-11-16");
    expect(changelog).toContain("Multi-Segment Turbo Engine");
    expect(changelog).toContain("Classic IDM-Class Desktop UI");
    expect(changelog).toContain("Browser Extension & Native Bridge");
    expect(changelog).toContain("Media Pipeline & Sniffer");
    expect(changelog).toContain("Queues, Scheduler & Speed Limiter");
    expect(changelog).toContain("BitTorrent & Magnet Links");
    expect(changelog).toContain("Headless CLI & Local JSON-RPC API");
    expect(changelog).toContain("Zero-Knowledge Cloud Sync");
  });

  it("verifies v1.0.0 release notes contain checksums and Minisign verification", () => {
    const notesPath = path.join(rootDir, "docs/release/v1.0.0-release-notes.md");
    expect(fs.existsSync(notesPath)).toBe(true);

    const notes = fs.readFileSync(notesPath, "utf-8");
    expect(notes).toContain("Release Notes — MJDM v1.0.0");
    expect(notes).toContain("MJDM-Setup-1.0.0.exe");
    expect(notes).toContain("MJDM-1.0.0.AppImage");
    expect(notes).toContain("minisign -Vm");
    expect(notes).toContain("System Requirements");
  });

  it("verifies Post-1.0 Roadmap covers all planned milestones v1.1 - v1.5", () => {
    const roadmapPath = path.join(rootDir, "docs/plans/post-1.0-roadmap.md");
    expect(fs.existsSync(roadmapPath)).toBe(true);

    const roadmap = fs.readFileSync(roadmapPath, "utf-8");
    expect(roadmap).toContain("Milestone v1.1: Native macOS Universal Port");
    expect(roadmap).toContain("Milestone v1.2: Mobile PWA & iOS / Android Companion");
    expect(roadmap).toContain("Milestone v1.3: E2EE Remote Relay");
    expect(roadmap).toContain("Milestone v1.4: BYO-Storage (Bring Your Own Storage) Sync");
    expect(roadmap).toContain("Milestone v1.5: Sandboxed Plugin SDK & Custom Site Resolvers");
    expect(roadmap).toContain("POST-01");
    expect(roadmap).toContain("POST-05");
  });

  it("publishes and validates v1.0.0 production update channel delivery", async () => {
    const updatesService = new UpdatesService();

    // Publish v1.0.0 stable for Windows
    await updatesService.publishRelease({
      version: "1.0.0",
      platform: "windows",
      architecture: "x86_64",
      channel: "stable",
      isMandatory: true,
      releaseNotes: "MJDM v1.0.0 General Availability Release",
      artifactUrl: "https://github.com/mjdm-org/mjdm/releases/download/v1.0.0/MJDM-Setup-1.0.0.exe",
      fileSize: 52428800,
      sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      signature: "minisign:RWQ1y0...",
      rolloutPercentage: 100,
    });

    // Check update for client on v0.9.0
    const update = await updatesService.checkUpdate("windows", "x86_64", "0.9.0", "stable");
    expect(update).not.toBeNull();
    expect(update?.version).toBe("1.0.0");
    expect(update?.url).toContain("MJDM-Setup-1.0.0.exe");
    expect(update?.signature).toBe("minisign:RWQ1y0...");

    // Client already on 1.0.0 receives null
    const noUpdate = await updatesService.checkUpdate("windows", "x86_64", "1.0.0", "stable");
    expect(noUpdate).toBeNull();
  });
});

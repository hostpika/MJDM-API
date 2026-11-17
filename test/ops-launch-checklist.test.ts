import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";

describe("Launch Checklist, Support Runbook & Rollback Playbook (P13-T06)", () => {
  const rootDir = path.resolve(__dirname, "..");
  const opsDir = path.resolve(rootDir, "docs/ops");

  it("verifies production launch checklist contains all pre-flight gates", () => {
    const checklistPath = path.join(opsDir, "launch-checklist.md");
    expect(fs.existsSync(checklistPath)).toBe(true);

    const content = fs.readFileSync(checklistPath, "utf-8");
    expect(content).toContain("Pre-Flight Infrastructure Readiness");
    expect(content).toContain("Observability & Alerting Matrix");
    expect(content).toContain("High Error Rate");
    expect(content).toContain("High Latency");
    expect(content).toContain("Security & Legal Sign-Off");
    expect(content).toContain("Packaging & Distribution Verification");
    expect(content).toContain("**Status:** READY FOR LAUNCH");
  });

  it("verifies customer support runbook contains SLAs and bilingual canned responses", () => {
    const runbookPath = path.join(opsDir, "support-runbook.md");
    expect(fs.existsSync(runbookPath)).toBe(true);

    const content = fs.readFileSync(runbookPath, "utf-8");
    expect(content).toContain("support@mjdm.app");
    expect(content).toContain("SLA Commitments");
    expect(content).toContain("< 4 hours");

    // Template 1: License activation
    expect(content).toContain("License Key Not Received");
    expect(content).toContain("লাইসেন্স সক্রিয় করার ধাপসমূহ");

    // Template 2: Zero-knowledge recovery key
    expect(content).toContain("Lost Passphrase");
    expect(content).toContain("Emergency Recovery Key");
    expect(content).toContain("১৬-অক্ষরের ইমার্জেন্সি রিকভারি কী");

    // Template 3: Browser bridge
    expect(content).toContain("Bridge Disconnected");
    expect(content).toContain("Reinstall Native Bridge Manifest");

    // Template 4: 14-day refund
    expect(content).toContain("14-Day Refund Processing");
    expect(content).toContain("১৪-দিনের মানি-ব্যাক গ্যারান্টি");
  });

  it("verifies disaster rollback plan covers desktop feed, Minisign keys, and DB rollbacks", () => {
    const rollbackPath = path.join(opsDir, "rollback-plan.md");
    expect(fs.existsSync(rollbackPath)).toBe(true);

    const content = fs.readFileSync(rollbackPath, "utf-8");
    expect(content).toContain("Sev-1 (Critical Emergency)");
    expect(content).toContain("Desktop Application Rollback Procedure");
    expect(content).toContain("halt_and_revert");
    expect(content).toContain("Cryptographic Key Compromise Procedure");
    expect(content).toContain("ADR-013");
    expect(content).toContain("Database Migration Rollback");
    expect(content).toContain("restore-db.sh");
  });

  it("verifies launch announcements pack contains all target platforms", () => {
    const annPath = path.join(opsDir, "launch-announcements.md");
    expect(fs.existsSync(annPath)).toBe(true);

    const content = fs.readFileSync(annPath, "utf-8");
    expect(content).toContain("Product Hunt Launch");
    expect(content).toContain("Hacker News Show HN");
    expect(content).toContain("Reddit Announcement");
    expect(content).toContain("r/software");
    expect(content).toContain("Bangladeshi Tech Community Announcement");
    expect(content).toContain("বিকাশ/নগদে লোকাল প্যারিটি প্রাইসিং");
  });
});

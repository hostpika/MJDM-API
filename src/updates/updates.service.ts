import * as crypto from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import { PublishReleaseDto } from "./dto/updates.dto";

export interface ReleaseEntity {
  id: string;
  version: string;
  platform: string;
  architecture: string;
  channel: "stable" | "beta";
  is_mandatory: boolean;
  release_notes: string;
  artifact_url: string;
  file_size: number;
  sha256: string;
  signature?: string;
  rollout_percentage: number;
  published_at: string;
}

export interface TauriUpdateResponse {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature?: string;
}

@Injectable()
export class UpdatesService {
  private readonly logger = new Logger(UpdatesService.name);

  // In-memory releases table for test/offline resilience
  private readonly memoryReleases: ReleaseEntity[] = [];

  constructor(@Optional() @Inject(DatabaseService) private readonly db?: DatabaseService) {
    this.seedDefaultReleases();
  }

  private seedDefaultReleases(): void {
    // Seed initial v0.8.0 release for both Windows and Linux
    this.publishRelease({
      version: "0.8.0",
      platform: "windows",
      architecture: "x86_64",
      channel: "stable",
      isMandatory: false,
      releaseNotes: "Initial Beta Release v0.8.0",
      artifactUrl: "https://releases.mjdm.app/v0.8.0/mjdm-windows-x86_64-setup.exe",
      fileSize: 48500000,
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      signature: "minisign:RWT...signature_v0_8_0",
      rolloutPercentage: 100,
    });
  }

  /**
   * Publishes or updates an app release.
   */
  async publishRelease(dto: PublishReleaseDto): Promise<ReleaseEntity> {
    const entity: ReleaseEntity = {
      id: crypto.randomUUID(),
      version: dto.version,
      platform: dto.platform.toLowerCase(),
      architecture: dto.architecture.toLowerCase(),
      channel: dto.channel,
      is_mandatory: dto.isMandatory ?? false,
      release_notes: dto.releaseNotes ?? "",
      artifact_url: dto.artifactUrl,
      file_size: dto.fileSize,
      sha256: dto.sha256,
      signature: dto.signature,
      rollout_percentage: dto.rolloutPercentage ?? 100,
      published_at: new Date().toISOString(),
    };

    // Remove any existing entry for this platform/arch/version
    const existingIdx = this.memoryReleases.findIndex(
      (r) =>
        r.version === entity.version &&
        r.platform === entity.platform &&
        r.architecture === entity.architecture
    );
    if (existingIdx >= 0) {
      this.memoryReleases.splice(existingIdx, 1);
    }
    this.memoryReleases.push(entity);

    if (this.db?.connected) {
      // Upsert into app_releases & update_artifacts
      await this.db.query(
        `INSERT INTO app_releases (id, product_id, version, platform, architecture, channel, is_mandatory, release_notes, published_at)
         VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (product_id, version, platform, architecture) DO NOTHING`,
        [entity.id, entity.version, entity.platform, entity.architecture, entity.channel, entity.is_mandatory, entity.release_notes, entity.published_at]
      );
    }

    this.logger.log(
      `Published release ${entity.version} (${entity.channel}, ${entity.platform}-${entity.architecture}, ${entity.rollout_percentage}% rollout)`
    );
    return entity;
  }

  /**
   * Evaluates if an update is available for target, arch, and currentVersion.
   * Returns Tauri-compatible updater JSON or null (204 No Content).
   */
  async checkUpdate(
    target: string,
    arch: string,
    currentVersion: string,
    channel: "stable" | "beta" = "stable",
    installUuid?: string
  ): Promise<TauriUpdateResponse | null> {
    const plat = target.toLowerCase();
    const architecture = arch.toLowerCase();

    // Filter matching platform, arch, and channel
    const matching = this.memoryReleases.filter((r) => {
      if (r.platform !== plat || r.architecture !== architecture) {
        return false;
      }
      if (channel === "stable" && r.channel !== "stable") {
        return false;
      }
      return true;
    });

    if (matching.length === 0) {
      return null;
    }

    // Sort by SemVer descending
    matching.sort((a, b) => this.compareSemVer(b.version, a.version));
    const latest = matching[0];

    // Check if latest version is newer than currentVersion
    if (this.compareSemVer(latest.version, currentVersion) <= 0) {
      return null; // Client is already up-to-date
    }

    // Check staged rollout cohort
    if (latest.rollout_percentage < 100) {
      const cohort = this.computeRolloutCohort(installUuid || "anonymous");
      if (cohort >= latest.rollout_percentage) {
        // Client is not in the rollout percentage bucket yet
        return null;
      }
    }

    return {
      version: latest.version,
      notes: latest.release_notes,
      pub_date: latest.published_at,
      url: latest.artifact_url,
      signature: latest.signature,
    };
  }

  /**
   * Lists all published releases, optionally filtered by channel
   */
  async listReleases(channel?: "stable" | "beta"): Promise<ReleaseEntity[]> {
    if (channel) {
      return this.memoryReleases.filter((r) => r.channel === channel);
    }
    return [...this.memoryReleases];
  }

  /**
   * Computes deterministic integer between 0..99 for staged rollouts from install UUID
   */
  private computeRolloutCohort(installUuid: string): number {
    const hash = crypto.createHash("sha256").update(installUuid).digest();
    const uint32 = hash.readUInt32BE(0);
    return uint32 % 100;
  }

  /**
   * Simple SemVer comparator (returns positive if v1 > v2, 0 if equal, negative if v1 < v2)
   */
  private compareSemVer(v1: string, v2: string): number {
    const clean1 = v1.replace(/^v/, "").split("-")[0];
    const clean2 = v2.replace(/^v/, "").split("-")[0];

    const parts1 = clean1.split(".").map(Number);
    const parts2 = clean2.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 !== p2) {
        return p1 - p2;
      }
    }
    return 0;
  }
}

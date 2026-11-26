import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { siteContentSchema } from "../site/site-content.schema";
import { SiteContentService } from "../site/site-content.service";

const INSTALLER = /^MJDM_(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)_x64-setup\.exe$/;
const MAX_INSTALLER_BYTES = 80 * 1024 * 1024;
/** Where the production server keeps installers and the update feed (served by nginx at /downloads/). */
const PRODUCTION_DIR = "/var/www/mjdm-downloads";

/** Turns a failed write into a message the admin can act on. */
function writeFailure(err: unknown): never {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    throw new InternalServerErrorException(
      "The API is not allowed to write to the downloads folder. On the server, give it to the API user (chown mjdm) and try again."
    );
  }
  throw err;
}

export interface ReleaseRow {
  version: string;
  file: string;
  sizeBytes: number;
  sizeMb: number;
  sha256: string;
  modifiedAt: string;
  signed: boolean;
  /** This is the version installed apps are told to update to. */
  current: boolean;
  /** This is the version the website's Download button points at. */
  onWebsite: boolean;
}

const semverParts = (v: string) => v.split("-")[0].split(".").map(Number);
const compareVersions = (a: string, b: string) => {
  const x = semverParts(a);
  const y = semverParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

/**
 * The installers served from the downloads folder, the update feed (latest.json) that installed
 * apps read, and the website's Download button. Publishing a version rewrites the feed and the
 * website in one step; nothing here ever executes an installer.
 */
@Injectable()
export class ReleasesService {
  private readonly hashCache = new Map<string, { mtime: number; sha: string }>();

  constructor(private readonly site: SiteContentService) {}

  private get dir(): string {
    return path.resolve(process.env.DOWNLOADS_DIR ?? (fs.existsSync(PRODUCTION_DIR) ? PRODUCTION_DIR : "data/downloads"));
  }
  private get baseUrl(): string {
    return (process.env.DOWNLOADS_BASE_URL ?? "https://mjdm.us/downloads").replace(/\/$/, "");
  }

  private feedVersion(): string | null {
    try {
      return (JSON.parse(fs.readFileSync(path.join(this.dir, "latest.json"), "utf-8")) as { version?: string }).version ?? null;
    } catch {
      return null;
    }
  }

  private sha(file: string, mtime: number): string {
    const hit = this.hashCache.get(file);
    if (hit && hit.mtime === mtime) return hit.sha;
    const sha = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    this.hashCache.set(file, { mtime, sha });
    return sha;
  }

  async list(): Promise<{ folderReady: boolean; feedVersion: string | null; releases: ReleaseRow[] }> {
    if (!fs.existsSync(this.dir)) return { folderReady: false, feedVersion: null, releases: [] };
    const feed = this.feedVersion();
    const websiteVersion = (await this.site.get()).content.release.version;
    const releases: ReleaseRow[] = [];
    for (const name of fs.readdirSync(this.dir)) {
      const m = INSTALLER.exec(name);
      if (!m) continue;
      const full = path.join(this.dir, name);
      const st = fs.statSync(full);
      releases.push({
        version: m[1],
        file: name,
        sizeBytes: st.size,
        sizeMb: Math.round((st.size / 1048576) * 100) / 100,
        sha256: this.sha(full, st.mtimeMs),
        modifiedAt: st.mtime.toISOString(),
        signed: fs.existsSync(`${full}.sig`),
        current: feed === m[1],
        onWebsite: websiteVersion === m[1],
      });
    }
    releases.sort((a, b) => compareVersions(b.version, a.version));
    return { folderReady: true, feedVersion: feed, releases };
  }

  /** Saves an uploaded installer or its signature. The name decides what it is; nothing else is trusted. */
  save(fileName: string, body: Buffer): { file: string; kind: "installer" | "signature" } {
    const isSig = fileName.endsWith(".sig");
    const installerName = isSig ? fileName.slice(0, -4) : fileName;
    if (!INSTALLER.test(installerName)) {
      throw new BadRequestException("The file must be named like MJDM_1.0.5_x64-setup.exe (and MJDM_1.0.5_x64-setup.exe.sig)");
    }
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException("The file is empty");
    if (isSig) {
      const text = body.toString("utf-8");
      if (body.length > 4096 || !text.trim()) throw new BadRequestException("That does not look like a signature file");
    } else {
      if (body.length > MAX_INSTALLER_BYTES) throw new BadRequestException("The installer is larger than 80 MB");
      if (body[0] !== 0x4d || body[1] !== 0x5a) throw new BadRequestException("That is not a Windows program (.exe)");
    }
    const target = path.join(this.dir, fileName);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = `${target}.upload`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, target);
    } catch (err) {
      writeFailure(err);
    }
    this.hashCache.delete(target);
    return { file: fileName, kind: isSig ? "signature" : "installer" };
  }

  /**
   * Makes `version` the one installed apps update to and the one the website offers. Needs the
   * installer and its signature to be uploaded already.
   */
  async publish(version: string, notes: string | undefined, by: string): Promise<ReleaseRow> {
    const file = `MJDM_${version}_x64-setup.exe`;
    if (!INSTALLER.test(file)) throw new BadRequestException("Not a valid version");
    const full = path.join(this.dir, file);
    if (!fs.existsSync(full)) throw new NotFoundException(`${file} is not uploaded yet`);
    if (!fs.existsSync(`${full}.sig`)) throw new BadRequestException(`${file}.sig is not uploaded yet; installed apps would refuse the update`);
    const st = fs.statSync(full);
    const signature = fs.readFileSync(`${full}.sig`, "utf-8").trim();

    // Check the website change is acceptable before touching anything, so a refusal leaves the
    // update feed and the website both exactly as they were.
    const content = structuredClone((await this.site.get()).content);
    content.release.version = version;
    content.release.windows.installerUrl = `${this.baseUrl}/${file}`;
    content.release.windows.installerSizeMb = Math.round((st.size / 1048576) * 100) / 100;
    content.release.windows.sha256 = this.sha(full, st.mtimeMs);
    const check = siteContentSchema.safeParse(content);
    if (!check.success) {
      const why = check.error.issues[0];
      throw new BadRequestException(`The website would not accept this release (${why.path.join(".")}: ${why.message}). Nothing was changed.`);
    }

    const feed = {
      version,
      notes: (notes ?? "").trim().slice(0, 2000) || `MJDM ${version}`,
      pub_date: new Date().toISOString(),
      platforms: { "windows-x86_64": { signature, url: `${this.baseUrl}/${file}` } },
    };
    try {
      const tmp = path.join(this.dir, "latest.json.tmp");
      fs.writeFileSync(tmp, `${JSON.stringify(feed, null, 2)}\n`);
      fs.renameSync(tmp, path.join(this.dir, "latest.json"));
    } catch (err) {
      writeFailure(err);
    }

    await this.site.set(content, by);

    return (await this.list()).releases.find((r) => r.version === version) as ReleaseRow;
  }
}

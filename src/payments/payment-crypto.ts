import * as crypto from "node:crypto";

/**
 * Gateway credentials are stored encrypted (AES-256-GCM). The key is derived from SERVER_PEPPER,
 * which is already a required secret of the API, so there is no extra key to lose or leak.
 * If SERVER_PEPPER changes, the stored credentials can no longer be read and must be entered again.
 */
function key(pepper: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(pepper, "utf8"), Buffer.alloc(0), "mjdm-payments-v1", 32)
  );
}

export function encryptJson(value: unknown, pepper: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(pepper), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}

export function decryptJson<T>(blob: string, pepper: string): T | null {
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(pepper), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

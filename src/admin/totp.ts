import * as crypto from "node:crypto";

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) implemented with node:crypto, no dependency. */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secretB32: string, atMs = Date.now(), stepSeconds = 30): string {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return (bin % 1_000_000).toString().padStart(6, "0");
}

/** Accepts the current code and one step either side (clock drift). Constant-time compare. */
export function verifyTotp(secretB32: string, code: string, atMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  let ok = false;
  for (const drift of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secretB32, atMs + drift * 30_000));
    if (crypto.timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export function otpauthUri(secretB32: string, account: string, issuer = "MJDM Admin"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

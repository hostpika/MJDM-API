import * as crypto from "node:crypto";

// Crockford's Base32 alphabet (omitting I, L, O, U)
export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export class LicenseKeyService {
  /**
   * Normalizes license key string:
   * Removes 'MJDM-' prefix, dashes, spaces, converts to uppercase,
   * maps 'I'/'L' to '1' and 'O' to '0'.
   */
  static normalize(key: string): string {
    let clean = key.trim().toUpperCase();
    if (clean.startsWith("MJDM")) {
      clean = clean.slice(4);
      if (clean.startsWith("-")) {
        clean = clean.slice(1);
      }
    }
    clean = clean.replace(/[^0-9A-Z]/g, "");
    clean = clean.replace(/[IL]/g, "1").replace(/O/g, "0");
    return clean;
  }

  /**
   * Generates a new license key in format: MJDM-XXXXX-XXXXX-XXXXX-XXXXX
   * 19 random Crockford characters + 1 check character = 20 chars total
   */
  static generate(): string {
    const chars: string[] = [];
    const randomBytes = crypto.randomBytes(19);

    for (let i = 0; i < 19; i++) {
      const idx = randomBytes[i] % CROCKFORD_ALPHABET.length;
      chars.push(CROCKFORD_ALPHABET[idx]);
    }

    // Check character: sum of character positions mod 32
    let sum = 0;
    for (const c of chars) {
      sum += CROCKFORD_ALPHABET.indexOf(c);
    }
    const checkChar = CROCKFORD_ALPHABET[sum % CROCKFORD_ALPHABET.length];
    chars.push(checkChar);

    // Format in 4 groups of 5 chars
    const full = chars.join("");
    return `MJDM-${full.slice(0, 5)}-${full.slice(5, 10)}-${full.slice(10, 15)}-${full.slice(15, 20)}`;
  }

  /**
   * Validates key format and check character
   */
  static isValid(key: string): boolean {
    const normalized = this.normalize(key);
    if (normalized.length !== 20) {
      return false;
    }

    for (const c of normalized) {
      if (!CROCKFORD_ALPHABET.includes(c)) {
        return false;
      }
    }

    let sum = 0;
    for (let i = 0; i < 19; i++) {
      sum += CROCKFORD_ALPHABET.indexOf(normalized[i]);
    }
    const expectedCheck = CROCKFORD_ALPHABET[sum % CROCKFORD_ALPHABET.length];
    return normalized[19] === expectedCheck;
  }

  /**
   * Computes HMAC-SHA256 of normalized key with server pepper.
   * Only this hash is stored in PostgreSQL (key_hmac).
   */
  static computeHmac(key: string, pepper: string): string {
    const normalized = this.normalize(key);
    return crypto.createHmac("sha256", pepper).update(normalized).digest("hex");
  }
}

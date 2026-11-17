const SENSITIVE_KEYWORDS = [
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "pepper",
  "licensekey",
  "apikey",
  "privatekey",
];

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_]/g, "");
  return SENSITIVE_KEYWORDS.some((kw) => normalized.includes(kw));
}

/**
 * Recursively redacts sensitive fields from objects or headers to prevent log leakage.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    // If it looks like a Bearer token or Crockford key, redact
    if (obj.toLowerCase().startsWith("bearer ")) {
      return "Bearer [REDACTED]";
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(key) && (typeof val !== "object" || val === null)) {
        if (key.toLowerCase() === "authorization" && typeof val === "string" && val.toLowerCase().startsWith("bearer ")) {
          sanitized[key] = "Bearer [REDACTED]";
        } else {
          sanitized[key] = "[REDACTED]";
        }
      } else {
        sanitized[key] = redactSensitiveData(val);
      }
    }
    return sanitized;
  }

  return obj;
}

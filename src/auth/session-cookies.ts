import type { NextFunction, Request, Response } from "express";
import type { AuthTokens } from "./token.service";

/**
 * Browser sessions: tokens live in HttpOnly cookies so page JavaScript (and therefore any XSS)
 * can never read them. Native clients (desktop app, CLI) keep using `Authorization: Bearer`.
 *
 * A request opts in to cookie mode with the header `X-MJDM-Client: web`. That header is not
 * CORS-safelisted, so a cross-site page cannot send it without a successful preflight, which the
 * origin allowlist refuses. Together with `SameSite=Lax` and an explicit Origin check this
 * covers CSRF for cookie-authenticated requests.
 */
export const ACCESS_COOKIE = "mjdm_at";
export const REFRESH_COOKIE = "mjdm_rt";
export const CLIENT_HEADER = "x-mjdm-client";

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // matches TokenService (15m)
const REFRESH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // matches TokenService (30d)
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isWebClient(req: Request): boolean {
  return req.headers[CLIENT_HEADER] === "web";
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setSessionCookies(res: Response, tokens: AuthTokens, secure: boolean): void {
  const base = { httpOnly: true, secure, sameSite: "lax" as const };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    path: "/",
    maxAge: ACCESS_MAX_AGE_MS,
  });
  // The refresh token is only ever needed by the auth endpoints, so scope it to them.
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    path: "/v1/auth",
    maxAge: REFRESH_MAX_AGE_MS,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  const base = { httpOnly: true, secure, sameSite: "lax" as const };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: "/v1/auth" });
}

/**
 * Express middleware:
 *  1. If the request carries no Authorization header but has the access cookie, present the
 *     cookie as a Bearer token so every existing controller works unchanged.
 *  2. For unsafe methods authenticated only by cookies, require `X-MJDM-Client: web` and, when
 *     an Origin header is present, an origin from the allowlist (CSRF defence).
 */
export function sessionCookieMiddleware(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.headers.authorization) {
      const access = readCookie(req, ACCESS_COOKIE);
      const refresh = readCookie(req, REFRESH_COOKIE);

      if (access) {
        req.headers.authorization = `Bearer ${access}`;
      }

      if ((access || refresh) && UNSAFE_METHODS.has(req.method)) {
        const origin = req.headers.origin;
        const originOk = !origin || allowed.has(origin);
        if (!isWebClient(req) || !originOk) {
          res.status(403).json({
            statusCode: 403,
            message: "Cross-site request blocked (CSRF protection)",
            error: "Forbidden",
          });
          return;
        }
      }
    }
    next();
  };
}

import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { AuthController } from "../src/auth/auth.controller";
import { AuthService } from "../src/auth/auth.service";
import { PasswordService } from "../src/auth/password.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  readCookie,
  sessionCookieMiddleware,
} from "../src/auth/session-cookies";
import { TokenService } from "../src/auth/token.service";
import { AppConfigService } from "../src/config/config.service";
import { validateEnv } from "../src/config/env.schema";
import { DatabaseService } from "../src/database/database.service";

interface CookieCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

function fakeRes() {
  const cookies: CookieCall[] = [];
  const cleared: { name: string; options: Record<string, unknown> }[] = [];
  const state = { status: 200, body: undefined as unknown };
  const res = {
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies.push({ name, value, options });
      return res;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      cleared.push({ name, options });
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
  };
  return { res: res as unknown as Response, cookies, cleared, state };
}

function fakeReq(
  headers: Record<string, string> = {},
  method = "POST"
): Request & { headers: Record<string, string> } {
  return { headers, method, socket: { remoteAddress: "10.1.1.1" } } as never;
}

describe("Browser sessions: HttpOnly cookies + CSRF protection", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const tokens = new TokenService(config);
  const authService = new AuthService(db, new PasswordService(), tokens, new RateLimiterService());
  const controller = new AuthController(authService, config);

  const creds = { email: "cookie_user@example.com", password: "ValidPassword123!" };

  describe("AuthController", () => {
    it("native clients still receive the token pair in the body and no cookies", async () => {
      const { res, cookies } = fakeRes();
      const out = (await controller.register(
        { ...creds, displayName: "Native" },
        fakeReq(),
        res
      )) as { tokens?: { accessToken: string } };

      expect(out.tokens?.accessToken).toBeTruthy();
      expect(cookies).toHaveLength(0);
    });

    it("web clients get HttpOnly SameSite=Lax cookies and never see tokens in the body", async () => {
      const { res, cookies } = fakeRes();
      const out = (await controller.login(
        { email: creds.email, password: creds.password },
        fakeReq({ "x-mjdm-client": "web" }),
        res
      )) as Record<string, unknown>;

      expect(out.tokens).toBeUndefined();
      expect(JSON.stringify(out)).not.toMatch(/eyJ/); // no JWT anywhere in the response body
      expect(out.expiresInSeconds).toBeTypeOf("number");

      const access = cookies.find((c) => c.name === ACCESS_COOKIE);
      const refresh = cookies.find((c) => c.name === REFRESH_COOKIE);
      expect(access?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
      expect(refresh?.options).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/v1/auth",
      });
      // The refresh token is scoped to the auth endpoints only.
      expect(access?.value).not.toBe(refresh?.value);
    });

    it("refreshes from the cookie when the body has no token, and rotates both cookies", async () => {
      const login = fakeRes();
      await controller.login(
        { email: creds.email, password: creds.password },
        fakeReq({ "x-mjdm-client": "web" }),
        login.res
      );
      const rt = login.cookies.find((c) => c.name === REFRESH_COOKIE)?.value ?? "";

      const { res, cookies } = fakeRes();
      const out = (await controller.refresh(
        {},
        fakeReq({ "x-mjdm-client": "web", cookie: `${REFRESH_COOKIE}=${rt}` }),
        res
      )) as Record<string, unknown>;

      expect(out.accessToken).toBeUndefined();
      expect(cookies.map((c) => c.name).sort()).toEqual([ACCESS_COOKIE, REFRESH_COOKIE].sort());
      expect(cookies.find((c) => c.name === REFRESH_COOKIE)?.value).not.toBe(rt); // rotated
    });

    it("rejects a refresh with neither body token nor cookie", async () => {
      const { res } = fakeRes();
      await expect(
        controller.refresh({}, fakeReq({ "x-mjdm-client": "web" }), res)
      ).rejects.toThrow(/Missing refresh token/);
    });

    it("logout clears both cookies", async () => {
      const { res, cleared } = fakeRes();
      await controller.logout({}, fakeReq({ "x-mjdm-client": "web" }), res);
      expect(cleared.map((c) => c.name).sort()).toEqual([ACCESS_COOKIE, REFRESH_COOKIE].sort());
    });
  });

  describe("sessionCookieMiddleware (CSRF)", () => {
    const allowed = ["https://mjdm.us", "https://admin.mjdm.us"];
    const run = (req: Request) => {
      const { res, state } = fakeRes();
      let nextCalled = false;
      sessionCookieMiddleware(allowed)(req, res, () => {
        nextCalled = true;
      });
      return { nextCalled, status: state.status };
    };

    it("presents the access cookie as a Bearer token to existing controllers", () => {
      const req = fakeReq({ cookie: `${ACCESS_COOKIE}=abc.def.ghi` }, "GET");
      expect(run(req).nextCalled).toBe(true);
      expect(req.headers.authorization).toBe("Bearer abc.def.ghi");
    });

    it("never overrides an explicit Authorization header", () => {
      const req = fakeReq(
        { authorization: "Bearer native-token", cookie: `${ACCESS_COOKIE}=cookie-token` },
        "GET"
      );
      run(req);
      expect(req.headers.authorization).toBe("Bearer native-token");
    });

    it("blocks a cookie-authenticated POST without the web-client header", () => {
      const out = run(fakeReq({ cookie: `${ACCESS_COOKIE}=t`, origin: "https://mjdm.us" }));
      expect(out).toEqual({ nextCalled: false, status: 403 });
    });

    it("blocks a cookie-authenticated POST from a foreign origin", () => {
      const out = run(
        fakeReq({
          cookie: `${ACCESS_COOKIE}=t`,
          "x-mjdm-client": "web",
          origin: "https://evil.example",
        })
      );
      expect(out).toEqual({ nextCalled: false, status: 403 });
    });

    it("allows a cookie-authenticated POST from an allowed origin with the header", () => {
      const out = run(
        fakeReq({
          cookie: `${ACCESS_COOKIE}=t`,
          "x-mjdm-client": "web",
          origin: "https://mjdm.us",
        })
      );
      expect(out.nextCalled).toBe(true);
    });

    it("does not interfere with requests that carry no session cookie", () => {
      expect(run(fakeReq({}, "POST")).nextCalled).toBe(true);
    });

    it("parses cookie headers safely", () => {
      const req = fakeReq({
        cookie: `a=1; ${ACCESS_COOKIE}=x%20y; broken; ${REFRESH_COOKIE}=%E0%A4%A`,
      });
      expect(readCookie(req, ACCESS_COOKIE)).toBe("x y");
      expect(readCookie(req, REFRESH_COOKIE)).toBeUndefined(); // malformed encoding => ignored
      expect(readCookie(req, "missing")).toBeUndefined();
    });
  });
});

describe("Production secrets", () => {
  const strong = {
    JWT_SECRET: "a".repeat(48),
    JWT_REFRESH_SECRET: "b".repeat(48),
    SERVER_PEPPER: "c".repeat(48),
  };

  it("refuses to start in production with missing (default) secrets", () => {
    expect(() => validateEnv({ NODE_ENV: "production" })).toThrow(/default or missing secrets/);
  });

  it("refuses the published default values even when set explicitly", () => {
    expect(() =>
      validateEnv({
        NODE_ENV: "production",
        ...strong,
        JWT_SECRET: "mjdm_default_jwt_secret_must_be_32_characters_minimum!",
      })
    ).toThrow(/JWT_SECRET/);
  });

  it("accepts unique secrets in production", () => {
    expect(validateEnv({ NODE_ENV: "production", ...strong }).NODE_ENV).toBe("production");
  });

  it("still allows the defaults in development and test", () => {
    expect(() => validateEnv({ NODE_ENV: "development" })).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: "test" })).not.toThrow();
  });
});

import * as crypto from "node:crypto";
import { Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { PasswordService } from "../auth/password.service";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { AppConfigService } from "../config/config.service";
import { verifyTotp } from "./totp";

export const ADMIN_COOKIE = "mjdm_admin";
export const ADMIN_SESSION_SECONDS = 60 * 60; // 1 hour, no refresh: admins log in again
const AUDIENCE = "mjdm-admin";

export interface AdminSession {
  sub: string; // admin email
  role: "admin";
}

/**
 * Admin accounts are configured by the operator in the environment (ADMIN_EMAIL,
 * ADMIN_PASSWORD_HASH, ADMIN_TOTP_SECRET), never self-registered, so there is no way to become an
 * admin through the public API. Login needs the password AND a TOTP code (MFA is mandatory).
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService
  ) {}

  get configured(): boolean {
    return Boolean(
      this.config.get("ADMIN_EMAIL") &&
        this.config.get("ADMIN_PASSWORD_HASH") &&
        this.config.get("ADMIN_TOTP_SECRET")
    );
  }

  async login(email: string, password: string, code: string, ip: string): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException("Admin login is not configured on this server");
    }
    // 5 attempts / 15 min per IP and 8 per account, counting every attempt.
    this.limiter.check(`admin-login:ip:${ip}`, 5, 15 * 60_000);
    this.limiter.check(`admin-login:acct:${email.toLowerCase()}`, 8, 15 * 60_000);

    const expectedEmail = (this.config.get("ADMIN_EMAIL") as string).toLowerCase();
    const emailOk = crypto.timingSafeEqual(
      crypto.createHash("sha256").update(email.toLowerCase()).digest(),
      crypto.createHash("sha256").update(expectedEmail).digest()
    );
    // Always run the password hash so timing does not reveal whether the email exists.
    const passwordOk = await this.passwords.verify(
      this.config.get("ADMIN_PASSWORD_HASH") as string,
      password
    );
    const codeOk = verifyTotp(this.config.get("ADMIN_TOTP_SECRET") as string, code);
    if (!(emailOk && passwordOk && codeOk)) {
      throw new UnauthorizedException("Invalid credentials or verification code");
    }
    return jwt.sign({ role: "admin" }, this.config.get("JWT_SECRET"), {
      algorithm: "HS256",
      expiresIn: ADMIN_SESSION_SECONDS,
      audience: AUDIENCE,
      subject: expectedEmail,
    });
  }

  verify(token: string): AdminSession {
    try {
      const p = jwt.verify(token, this.config.get("JWT_SECRET"), {
        algorithms: ["HS256"],
        audience: AUDIENCE,
      }) as jwt.JwtPayload;
      if (p.role !== "admin" || typeof p.sub !== "string") throw new Error("not admin");
      return { sub: p.sub, role: "admin" };
    } catch {
      throw new UnauthorizedException("Admin session required");
    }
  }
}

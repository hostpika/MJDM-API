import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { PasswordService } from "../auth/password.service";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { AppConfigService } from "../config/config.service";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

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
 * admin through the public API. Two-step verification (TOTP) is OFF by default and can be
 * switched on or off by the admin from the panel; when on, every login also needs the code.
 * ADMIN_TOTP_SECRET in the environment forces it on and cannot be turned off from the panel.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly limiter: RateLimiterService
  ) {}

  private pendingSecret: string | null = null;
  private get mfaFile(): string {
    return path.resolve(process.env.ADMIN_MFA_FILE ?? "data/admin-mfa.json");
  }

  get configured(): boolean {
    return Boolean(this.config.get("ADMIN_EMAIL") && this.config.get("ADMIN_PASSWORD_HASH"));
  }

  /** The active TOTP secret: forced by the environment, else the one saved from the panel. */
  private mfaSecret(): string | null {
    const forced = this.config.get("ADMIN_TOTP_SECRET");
    if (forced) return forced as string;
    try {
      const saved = JSON.parse(fs.readFileSync(this.mfaFile, "utf-8")) as { secret?: string };
      return typeof saved.secret === "string" && saved.secret ? saved.secret : null;
    } catch {
      return null;
    }
  }

  mfaStatus(): { enabled: boolean; locked: boolean } {
    return { enabled: this.mfaSecret() !== null, locked: Boolean(this.config.get("ADMIN_TOTP_SECRET")) };
  }

  /** Step 1 of turning 2FA on: make a secret (not active yet) for the admin to add to an app. */
  beginMfaSetup(account: string): { secret: string; otpauth: string } {
    if (this.mfaSecret()) throw new BadRequestException("Two-step verification is already on");
    this.pendingSecret = generateTotpSecret();
    return { secret: this.pendingSecret, otpauth: otpauthUri(this.pendingSecret, account) };
  }

  /** Step 2: the admin proves the app works by entering a current code; only then it is saved. */
  enableMfa(code: string): void {
    if (!this.pendingSecret) throw new BadRequestException("Start the setup first");
    if (!verifyTotp(this.pendingSecret, code)) {
      throw new BadRequestException("That code is not right. Check the app and try again.");
    }
    fs.mkdirSync(path.dirname(this.mfaFile), { recursive: true });
    fs.writeFileSync(this.mfaFile, JSON.stringify({ secret: this.pendingSecret }), { mode: 0o600 });
    this.pendingSecret = null;
  }

  /** Turning it off needs the password and a current code (a stolen session alone cannot do it). */
  async disableMfa(password: string, code: string): Promise<void> {
    const secret = this.mfaSecret();
    if (!secret) return;
    if (this.mfaStatus().locked) {
      throw new BadRequestException("2FA is enforced by the server configuration");
    }
    const okPw = await this.passwords.verify(this.config.get("ADMIN_PASSWORD_HASH") as string, password);
    if (!okPw || !verifyTotp(secret, code)) {
      throw new UnauthorizedException("Wrong password or code");
    }
    fs.rmSync(this.mfaFile, { force: true });
  }

  async login(email: string, password: string, code: string | undefined, ip: string): Promise<string> {
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
    const secret = this.mfaSecret();
    const codeOk = secret === null || verifyTotp(secret, code ?? "");
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

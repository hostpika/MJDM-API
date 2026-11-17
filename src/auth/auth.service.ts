import * as crypto from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { DatabaseService } from "../database/database.service";
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from "./dto/auth.dto";
import { PasswordService } from "./password.service";
import { RateLimiterService } from "./rate-limiter.service";
import { AuthTokens, TokenService } from "./token.service";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  status: string;
  email_verified_at: string | null;
  created_at: string;
}

export interface RefreshTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  device_id: string | null;
  expires_at: string;
}

@Injectable()
export class AuthService {
  // In-memory fallback stores for test/offline environments
  private readonly memoryUsers = new Map<string, UserRecord>();
  private readonly memoryRefreshTokens = new Map<string, RefreshTokenRecord>();
  private readonly verificationTokens = new Map<string, string>(); // token -> userId
  private readonly resetTokens = new Map<string, string>(); // token -> userId

  constructor(
    private readonly db: DatabaseService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly rateLimiter: RateLimiterService
  ) {}

  async register(
    dto: RegisterDto,
    ip: string
  ): Promise<{ user: Omit<UserRecord, "password_hash">; tokens: AuthTokens }> {
    this.rateLimiter.check(`register:${ip}`, 5, 60000);

    const email = dto.email.trim().toLowerCase();
    const existing = await this.findUserByEmail(email);
    if (existing) {
      throw new ConflictException("User with this email already exists");
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();

    const user: UserRecord = {
      id: userId,
      email,
      password_hash: passwordHash,
      display_name: dto.displayName?.trim() ?? null,
      status: "active",
      email_verified_at: null,
      created_at: now,
    };

    if (this.db.connected) {
      await this.db.query(
        `INSERT INTO users (id, email, password_hash, display_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [user.id, user.email, user.password_hash, user.display_name, user.status, now]
      );
    } else {
      this.memoryUsers.set(userId, user);
    }

    // Generate tokens
    const tokens = await this.createTokenPair(userId, email);

    // Save verification token
    const verifyToken = crypto.randomBytes(32).toString("hex");
    this.verificationTokens.set(verifyToken, userId);

    const { password_hash: _, ...safeUser } = user;
    return { user: safeUser, tokens };
  }

  async login(
    dto: LoginDto,
    ip: string
  ): Promise<{ user: Omit<UserRecord, "password_hash">; tokens: AuthTokens }> {
    this.rateLimiter.check(`login:${ip}`, 5, 60000);

    const email = dto.email.trim().toLowerCase();
    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const isValidPassword = await this.passwordService.verify(user.password_hash, dto.password);
    if (!isValidPassword) {
      throw new UnauthorizedException("Invalid email or password");
    }

    if (user.status !== "active") {
      throw new UnauthorizedException(`Account is ${user.status}`);
    }

    const tokens = await this.createTokenPair(user.id, user.email, dto.deviceId);
    const { password_hash: _, ...safeUser } = user;
    return { user: safeUser, tokens };
  }

  async refresh(refreshToken: string, ip: string): Promise<AuthTokens> {
    this.rateLimiter.check(`refresh:${ip}`, 30, 60000);

    const payload = this.tokenService.verifyRefreshToken(refreshToken);
    const tokenHash = this.tokenService.hashToken(refreshToken);

    const tokenRecord = await this.findRefreshToken(tokenHash);
    if (!tokenRecord) {
      throw new UnauthorizedException("Refresh token is invalid or has been revoked");
    }

    // Check expiration
    if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
      await this.revokeRefreshToken(tokenHash);
      throw new UnauthorizedException("Refresh token has expired");
    }

    // Rotate: invalidate old refresh token immediately (Single-use rotation)
    await this.revokeRefreshToken(tokenHash);

    const user = await this.findUserById(payload.sub);
    if (!user || user.status !== "active") {
      throw new UnauthorizedException("User account not active");
    }

    return this.createTokenPair(user.id, user.email, payload.deviceId);
  }

  async logout(refreshToken: string): Promise<{ success: boolean }> {
    const tokenHash = this.tokenService.hashToken(refreshToken);
    await this.revokeRefreshToken(tokenHash);
    return { success: true };
  }

  async verifyEmail(token: string): Promise<{ success: boolean; email: string }> {
    const userId = this.verificationTokens.get(token);
    if (!userId) {
      throw new BadRequestException("Invalid or expired email verification token");
    }

    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    user.email_verified_at = new Date().toISOString();
    if (this.db.connected) {
      await this.db.query(
        "UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1",
        [userId]
      );
    }
    this.verificationTokens.delete(token);

    return { success: true, email: user.email };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    ip: string
  ): Promise<{ message: string; resetToken?: string }> {
    this.rateLimiter.check(`forgot-password:${ip}`, 3, 60000);

    const email = dto.email.trim().toLowerCase();
    const user = await this.findUserByEmail(email);
    // Generic response to prevent email enumeration
    const genericMessage = "If that email is registered, password reset instructions have been sent.";

    if (!user) {
      return { message: genericMessage };
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    this.resetTokens.set(resetToken, user.id);

    return {
      message: genericMessage,
      resetToken, // Included for test/dev environments
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean }> {
    const userId = this.resetTokens.get(dto.token);
    if (!userId) {
      throw new BadRequestException("Invalid or expired password reset token");
    }

    const user = await this.findUserById(userId);
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const newHash = await this.passwordService.hash(dto.newPassword);
    user.password_hash = newHash;

    if (this.db.connected) {
      await this.db.query(
        "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
        [newHash, userId]
      );
    }

    this.resetTokens.delete(dto.token);

    // Invalidate all active refresh tokens for this user on password reset
    await this.revokeAllUserRefreshTokens(userId);

    return { success: true };
  }

  // --- Helper methods ---

  private async createTokenPair(
    userId: string,
    email: string,
    deviceId?: string
  ): Promise<AuthTokens> {
    const accessToken = this.tokenService.signAccessToken({
      sub: userId,
      email,
    });

    const { token: refreshToken } = this.tokenService.signRefreshToken(userId, deviceId);
    const tokenHash = this.tokenService.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const record: RefreshTokenRecord = {
      id: crypto.randomUUID(),
      user_id: userId,
      token_hash: tokenHash,
      device_id: deviceId ?? null,
      expires_at: expiresAt,
    };

    if (this.db.connected) {
      await this.db.query(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [record.id, record.user_id, record.token_hash, record.device_id, record.expires_at]
      );
    } else {
      this.memoryRefreshTokens.set(tokenHash, record);
    }

    return {
      accessToken,
      refreshToken,
      expiresInSeconds: 900, // 15 mins
    };
  }

  private async findUserByEmail(email: string): Promise<UserRecord | null> {
    if (this.db.connected) {
      const res = await this.db.query<UserRecord>(
        "SELECT * FROM users WHERE email = $1 LIMIT 1",
        [email]
      );
      return res.rows[0] ?? null;
    }
    for (const u of this.memoryUsers.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    if (this.db.connected) {
      const res = await this.db.query<UserRecord>(
        "SELECT * FROM users WHERE id = $1 LIMIT 1",
        [id]
      );
      return res.rows[0] ?? null;
    }
    return this.memoryUsers.get(id) ?? null;
  }

  async updatePasswordHash(userId: string, newHash: string): Promise<void> {
    if (this.db.connected) {
      await this.db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [newHash, userId]);
    } else {
      const user = this.memoryUsers.get(userId);
      if (user) {
        user.password_hash = newHash;
      }
    }
    await this.revokeAllUserRefreshTokens(userId);
  }

  async updateUserProfile(userId: string, displayName: string | null): Promise<UserRecord | null> {
    if (this.db.connected) {
      const res = await this.db.query<UserRecord>(
        "UPDATE users SET display_name = $1 WHERE id = $2 RETURNING *",
        [displayName, userId]
      );
      return res.rows[0] ?? null;
    } else {
      const user = this.memoryUsers.get(userId);
      if (user) {
        user.display_name = displayName;
        return user;
      }
      return null;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    if (this.db.connected) {
      await this.db.query("DELETE FROM users WHERE id = $1", [userId]);
    } else {
      this.memoryUsers.delete(userId);
    }
    await this.revokeAllUserRefreshTokens(userId);
  }

  private async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    if (this.db.connected) {
      const res = await this.db.query<RefreshTokenRecord>(
        "SELECT * FROM refresh_tokens WHERE token_hash = $1 LIMIT 1",
        [tokenHash]
      );
      return res.rows[0] ?? null;
    }
    return this.memoryRefreshTokens.get(tokenHash) ?? null;
  }

  private async revokeRefreshToken(tokenHash: string): Promise<void> {
    if (this.db.connected) {
      await this.db.query("DELETE FROM refresh_tokens WHERE token_hash = $1", [tokenHash]);
    } else {
      this.memoryRefreshTokens.delete(tokenHash);
    }
  }

  private async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    if (this.db.connected) {
      await this.db.query("DELETE FROM refresh_tokens WHERE user_id = $1", [userId]);
    } else {
      for (const [hash, rec] of this.memoryRefreshTokens.entries()) {
        if (rec.user_id === userId) {
          this.memoryRefreshTokens.delete(hash);
        }
      }
    }
  }
}

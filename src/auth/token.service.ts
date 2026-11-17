import * as crypto from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { AppConfigService } from "../config/config.service";

export interface AccessTokenPayload {
  sub: string; // user_id
  email: string;
  role?: string;
}

export interface RefreshTokenPayload {
  sub: string; // user_id
  jti: string; // unique token id
  deviceId?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

@Injectable()
export class TokenService {
  constructor(private readonly config: AppConfigService) {}

  signAccessToken(payload: AccessTokenPayload): string {
    const secret = this.config.get("JWT_SECRET");
    return jwt.sign(payload, secret, {
      expiresIn: "15m",
      algorithm: "HS256",
    });
  }

  signRefreshToken(userId: string, deviceId?: string): { token: string; jti: string } {
    const secret = this.config.get("JWT_REFRESH_SECRET");
    const jti = crypto.randomUUID();
    const payload: RefreshTokenPayload = { sub: userId, jti, deviceId };
    const token = jwt.sign(payload, secret, {
      expiresIn: "30d",
      algorithm: "HS256",
    });
    return { token, jti };
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const secret = this.config.get("JWT_SECRET");
      return jwt.verify(token, secret) as AccessTokenPayload;
    } catch {
      throw new UnauthorizedException("Invalid or expired access token");
    }
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const secret = this.config.get("JWT_REFRESH_SECRET");
      return jwt.verify(token, secret) as RefreshTokenPayload;
    } catch {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
  }

  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
}

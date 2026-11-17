import { describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/auth.service";
import { PasswordService } from "../src/auth/password.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import { TokenService } from "../src/auth/token.service";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";

describe("P10-T02: Auth & Session Management", () => {
  const config = new AppConfigService();
  const db = new DatabaseService(config);
  const passwordService = new PasswordService();
  const tokenService = new TokenService(config);
  const rateLimiter = new RateLimiterService();
  const authService = new AuthService(db, passwordService, tokenService, rateLimiter);

  describe("Argon2id Password Hashing", () => {
    it("should hash password with Argon2id and verify correctly", async () => {
      const plain = "Secr3tP@ssw0rd123";
      const hash = await passwordService.hash(plain);

      expect(hash).toContain("$argon2id$");
      const isValid = await passwordService.verify(hash, plain);
      expect(isValid).toBe(true);

      const isInvalid = await passwordService.verify(hash, "wrongpassword");
      expect(isInvalid).toBe(false);
    });
  });

  describe("User Registration & Login Lifecycle", () => {
    const testEmail = "test_user@example.com";
    const testPassword = "ValidPassword123!";

    it("should register a new user and return tokens", async () => {
      const reg = await authService.register(
        { email: testEmail, password: testPassword, displayName: "Tester" },
        "10.0.0.1"
      );

      expect(reg.user.id).toBeDefined();
      expect(reg.user.email).toBe(testEmail);
      expect(reg.user.display_name).toBe("Tester");
      expect(reg.tokens.accessToken).toBeDefined();
      expect(reg.tokens.refreshToken).toBeDefined();

      const decodedAccess = tokenService.verifyAccessToken(reg.tokens.accessToken);
      expect(decodedAccess.sub).toBe(reg.user.id);
      expect(decodedAccess.email).toBe(testEmail);
    });

    it("should reject duplicate registration with same email", async () => {
      await expect(
        authService.register({ email: testEmail, password: "AnotherPassword123!" }, "10.0.0.1")
      ).rejects.toThrow(/already exists/);
    });

    it("should successfully log in with correct credentials", async () => {
      const loginRes = await authService.login(
        { email: testEmail, password: testPassword },
        "10.0.0.2"
      );

      expect(loginRes.user.email).toBe(testEmail);
      expect(loginRes.tokens.accessToken).toBeDefined();
      expect(loginRes.tokens.refreshToken).toBeDefined();
    });

    it("should reject login with wrong password", async () => {
      await expect(
        authService.login({ email: testEmail, password: "IncorrectPassword!" }, "10.0.0.3")
      ).rejects.toThrow(/Invalid email or password/);
    });
  });

  describe("Refresh Token Rotation & Invalidation", () => {
    it("should rotate refresh token and revoke the previous one", async () => {
      const email = "rotate_test@example.com";
      const reg = await authService.register(
        { email, password: "SecretPassword123!" },
        "10.0.0.4"
      );

      const oldRefresh = reg.tokens.refreshToken;

      // First refresh: should succeed and issue new tokens
      const newTokens = await authService.refresh(oldRefresh, "10.0.0.4");
      expect(newTokens.accessToken).toBeDefined();
      expect(newTokens.refreshToken).toBeDefined();
      expect(newTokens.refreshToken).not.toBe(oldRefresh);

      // Replaying the old refresh token MUST fail (Single-use rotation invariant)
      await expect(authService.refresh(oldRefresh, "10.0.0.4")).rejects.toThrow(
        /invalid or has been revoked/
      );
    });

    it("should invalidate refresh token upon logout", async () => {
      const email = "logout_test@example.com";
      const reg = await authService.register(
        { email, password: "SecretPassword123!" },
        "10.0.0.5"
      );

      await authService.logout(reg.tokens.refreshToken);

      await expect(authService.refresh(reg.tokens.refreshToken, "10.0.0.5")).rejects.toThrow(
        /invalid or has been revoked/
      );
    });
  });

  describe("Email Verification & Password Reset", () => {
    it("should handle forgot password and reset password lifecycle", async () => {
      const email = "reset_test@example.com";
      const oldPass = "OldPassword123!";
      const newPass = "NewStrongPassword456!";

      await authService.register({ email, password: oldPass }, "10.0.0.6");

      const forgotRes = await authService.forgotPassword({ email }, "10.0.0.6");
      expect(forgotRes.resetToken).toBeDefined();

      const resetRes = await authService.resetPassword({
        token: forgotRes.resetToken!,
        newPassword: newPass,
      });
      expect(resetRes.success).toBe(true);

      // Old password should fail
      await expect(authService.login({ email, password: oldPass }, "10.0.0.6")).rejects.toThrow(
        /Invalid email or password/
      );

      // New password should succeed
      const newLogin = await authService.login({ email, password: newPass }, "10.0.0.6");
      expect(newLogin.user.email).toBe(email);
    });
  });

  describe("Rate Limiting Protection", () => {
    it("should block requests when rate limit is exceeded", () => {
      const testIp = "192.168.10.99";
      const testKey = `login:${testIp}`;

      // Max 5 attempts
      for (let i = 0; i < 5; i++) {
        expect(() => rateLimiter.check(testKey, 5, 60000)).not.toThrow();
      }

      // 6th attempt must be rejected with 429
      expect(() => rateLimiter.check(testKey, 5, 60000)).toThrow(/Rate limit exceeded/);
    });
  });
});

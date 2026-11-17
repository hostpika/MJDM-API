import { describe, expect, it } from "vitest";
import { AccountService } from "../src/account/account.service";
import { AuthService } from "../src/auth/auth.service";
import { PasswordService } from "../src/auth/password.service";
import { RateLimiterService } from "../src/auth/rate-limiter.service";
import { TokenService } from "../src/auth/token.service";
import { AppConfigService } from "../src/config/config.service";
import { DatabaseService } from "../src/database/database.service";
import { LicensesService } from "../src/licenses/licenses.service";
import { BillingService } from "../src/billing/billing.service";

describe("P10-T08: Customer Account & Portal Subsystem (cloud-api)", () => {
  it("should retrieve customer profile, update name, and change password", async () => {
    const config = new AppConfigService();
    const db = new DatabaseService(config);
    const pass = new PasswordService();
    const tokens = new TokenService(config);
    const limiter = new RateLimiterService();
    const auth = new AuthService(db, pass, tokens, limiter);
    const licenses = new LicensesService(db, config);
    const billing = new BillingService(db, config, licenses);
    const account = new AccountService(db, auth, pass, licenses, billing);

    // Register user
    const reg = await auth.register(
      {
        email: "customer@example.com",
        password: "OldPassword123!",
        displayName: "Customer One",
      },
      "127.0.0.1"
    );

    // Get Profile
    const profile = await account.getProfile(reg.user.id);
    expect(profile.email).toBe("customer@example.com");
    expect(profile.displayName).toBe("Customer One");

    // Update Profile
    const updated = await account.updateProfile(reg.user.id, "Customer Meraj");
    expect(updated.displayName).toBe("Customer Meraj");

    // Change Password
    const changed = await account.changePassword(
      reg.user.id,
      "OldPassword123!",
      "BrandNewPassword999!"
    );
    expect(changed.success).toBe(true);

    // Login with new password
    const login = await auth.login(
      {
        email: "customer@example.com",
        password: "BrandNewPassword999!",
      },
      "127.0.0.1"
    );
    expect(login.tokens.accessToken).toBeDefined();

    // Old password should fail
    await expect(
      auth.login(
        {
          email: "customer@example.com",
          password: "OldPassword123!",
        },
        "127.0.0.1"
      )
    ).rejects.toThrow();
  });

  it("should handle device listing, deactivation, and sync data purge", async () => {
    const config = new AppConfigService();
    const db = new DatabaseService(config);
    const pass = new PasswordService();
    const tokens = new TokenService(config);
    const limiter = new RateLimiterService();
    const auth = new AuthService(db, pass, tokens, limiter);
    const licenses = new LicensesService(db, config);
    const billing = new BillingService(db, config, licenses);
    const account = new AccountService(db, auth, pass, licenses, billing);

    const reg = await auth.register(
      {
        email: "syncuser@example.com",
        password: "SyncPassword123!",
      },
      "127.0.0.1"
    );

    const userLicenses = await account.getLicenses(reg.user.id);
    expect(Array.isArray(userLicenses)).toBe(true);

    const devices = await account.getDevices(reg.user.id);
    expect(Array.isArray(devices)).toBe(true);

    const deact = await account.deactivateDevice(reg.user.id, "nonexistent-device");
    expect(deact.success).toBe(true);

    const syncPurge = await account.eraseSyncData(reg.user.id);
    expect(syncPurge.success).toBe(true);

    const accountDelete = await account.deleteAccount(reg.user.id);
    expect(accountDelete.success).toBe(true);
  });
});

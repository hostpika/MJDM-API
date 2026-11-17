import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { PasswordService } from "../auth/password.service";
import { BillingService } from "../billing/billing.service";
import { DatabaseService } from "../database/database.service";
import { LicensesService } from "../licenses/licenses.service";

export interface AccountProfile {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  emailVerified: boolean;
  createdAt: string;
}

@Injectable()
export class AccountService {
  constructor(
    @Optional() @Inject(DatabaseService) private readonly db?: DatabaseService,
    @Optional() @Inject(AuthService) private readonly authService?: AuthService,
    @Optional() @Inject(PasswordService) private readonly passwordService?: PasswordService,
    @Optional() @Inject(LicensesService) private readonly licensesService?: LicensesService,
    @Optional() @Inject(BillingService) private readonly billingService?: BillingService
  ) {}

  async getProfile(userId: string): Promise<AccountProfile> {
    const user = await this.authService?.findUserById(userId);
    if (!user) {
      throw new NotFoundException("User account not found");
    }

    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      status: user.status,
      emailVerified: user.email_verified_at !== null,
      createdAt: user.created_at,
    };
  }

  async updateProfile(
    userId: string,
    displayName: string | null
  ): Promise<AccountProfile> {
    const user = await this.authService?.findUserById(userId);
    if (!user) {
      throw new NotFoundException("User account not found");
    }

    const updated = await this.authService?.updateUserProfile(userId, displayName);
    return {
      id: user.id,
      email: user.email,
      displayName: updated?.display_name ?? displayName,
      status: user.status,
      emailVerified: user.email_verified_at !== null,
      createdAt: user.created_at,
    };
  }

  async changePassword(
    userId: string,
    currentPass: string,
    newPass: string
  ): Promise<{ success: boolean }> {
    const user = await this.authService?.findUserById(userId);
    if (!user) {
      throw new NotFoundException("User account not found");
    }

    if (this.passwordService) {
      const valid = await this.passwordService.verify(user.password_hash, currentPass);
      if (!valid) {
        throw new ForbiddenException("Current password is incorrect");
      }
      if (newPass.length < 8) {
        throw new BadRequestException("New password must be at least 8 characters long");
      }
      const newHash = await this.passwordService.hash(newPass);
      await this.authService?.updatePasswordHash(userId, newHash);
    }
    return { success: true };
  }

  async getLicenses(userId: string) {
    return this.licensesService?.getLicensesForUser(userId) ?? [];
  }

  async getDevices(userId: string) {
    return this.licensesService?.getDevicesForUser(userId) ?? [];
  }

  async deactivateDevice(userId: string, deviceId: string): Promise<{ success: boolean }> {
    const success = await this.licensesService?.deactivateDeviceById(userId, deviceId) ?? true;
    return { success };
  }

  async getInvoices(userId: string) {
    return this.billingService?.getInvoices(userId) ?? [];
  }

  async eraseSyncData(userId: string): Promise<{ success: boolean; erasedRecords: number }> {
    if (this.db?.connected) {
      const res = await this.db.query("DELETE FROM sync_records WHERE user_id = $1", [userId]);
      await this.db.query("DELETE FROM sync_tombstones WHERE user_id = $1", [userId]);
      return { success: true, erasedRecords: res.rowCount ?? 0 };
    }
    return { success: true, erasedRecords: 0 };
  }

  async deleteAccount(userId: string): Promise<{ success: boolean }> {
    if (this.db?.connected) {
      await this.db.query("DELETE FROM sync_records WHERE user_id = $1", [userId]);
      await this.db.query("DELETE FROM sync_tombstones WHERE user_id = $1", [userId]);
      await this.db.query("DELETE FROM license_activations WHERE device_id IN (SELECT id FROM devices WHERE user_id = $1)", [userId]);
      await this.db.query("DELETE FROM devices WHERE user_id = $1", [userId]);
      await this.db.query("DELETE FROM licenses WHERE user_id = $1", [userId]);
    }
    await this.authService?.deleteUser(userId);
    return { success: true };
  }
}

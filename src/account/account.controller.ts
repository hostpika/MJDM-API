import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { TokenService } from "../auth/token.service";
import { AccountService } from "./account.service";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/account.dto";

@ApiTags("Customer Account & Portal")
@Controller("v1/account")
export class AccountController {
  constructor(
    private readonly accountService: AccountService,
    private readonly tokenService: TokenService
  ) {}

  private extractUserId(authHeader?: string): string {
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or invalid Bearer authorization header");
    }
    const token = authHeader.slice(7).trim();
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      return payload.sub;
    } catch {
      throw new UnauthorizedException("Invalid access token");
    }
  }

  @Get("me")
  @ApiOperation({ summary: "Get customer account profile" })
  @ApiResponse({ status: 200, description: "Account profile" })
  async getProfile(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.getProfile(userId);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update customer profile display name" })
  @ApiResponse({ status: 200, description: "Updated profile" })
  async updateProfile(
    @Headers("authorization") authHeader: string | undefined,
    @Body() dto: UpdateProfileDto
  ) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.updateProfile(userId, dto.displayName ?? null);
  }

  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Change account password and invalidate existing sessions" })
  @ApiResponse({ status: 200, description: "Password changed successfully" })
  async changePassword(
    @Headers("authorization") authHeader: string | undefined,
    @Body() dto: ChangePasswordDto
  ) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.changePassword(userId, dto.currentPassword, dto.newPassword);
  }

  @Get("licenses")
  @ApiOperation({ summary: "List active and historical licenses owned by customer" })
  @ApiResponse({ status: 200, description: "List of licenses" })
  async getLicenses(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.getLicenses(userId);
  }

  @Get("devices")
  @ApiOperation({ summary: "List devices connected to customer licenses" })
  @ApiResponse({ status: 200, description: "List of connected devices" })
  async getDevices(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.getDevices(userId);
  }

  @Delete("devices/:id")
  @ApiOperation({ summary: "Remotely deactivate a device from customer licenses" })
  @ApiResponse({ status: 200, description: "Device deactivated" })
  async deactivateDevice(
    @Headers("authorization") authHeader: string | undefined,
    @Param("id") deviceId: string
  ) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.deactivateDevice(userId, deviceId);
  }

  @Get("invoices")
  @ApiOperation({ summary: "List payment invoices and receipts for customer" })
  @ApiResponse({ status: 200, description: "List of invoice receipts" })
  async getInvoices(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.getInvoices(userId);
  }

  @Delete("sync")
  @ApiOperation({ summary: "GDPR erase all encrypted cloud sync data blobs" })
  @ApiResponse({ status: 200, description: "Sync data purged" })
  async eraseSync(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.eraseSyncData(userId);
  }

  @Delete()
  @ApiOperation({ summary: "GDPR delete entire account and all associated data" })
  @ApiResponse({ status: 200, description: "Account and data purged" })
  async deleteAccount(@Headers("authorization") authHeader?: string) {
    const userId = this.extractUserId(authHeader);
    return this.accountService.deleteAccount(userId);
  }
}

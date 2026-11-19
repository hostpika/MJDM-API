import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { Request, Response } from "express";
import { AppConfigService } from "../config/config.service";
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, AdminAuthService } from "./admin-auth.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";

export class AdminLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Only needed when two-step verification is switched on. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: "code must be the 6-digit authenticator code" })
  code?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: "The new password must be at least 10 characters" })
  @MaxLength(200)
  newPassword!: string;
}

export class MfaCodeDto {
  @Matches(/^\d{6}$/, { message: "code must be the 6-digit authenticator code" })
  code!: string;
}

export class MfaDisableDto extends MfaCodeDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}

@ApiTags("Admin Auth")
@Controller("v1/admin/auth")
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: AppConfigService
  ) {}

  private cookieOpts() {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: "strict" as const,
      path: "/",
    };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Admin login: email + password (+ TOTP code when 2FA is on)" })
  async login(
    @Body() dto: AdminLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : (req.socket?.remoteAddress ?? "ip");
    const token = await this.auth.login(dto.email, dto.password, dto.code, ip);
    res.cookie(ADMIN_COOKIE, token, { ...this.cookieOpts(), maxAge: ADMIN_SESSION_SECONDS * 1000 });
    return {
      email: dto.email.toLowerCase(),
      role: "admin",
      expiresInSeconds: ADMIN_SESSION_SECONDS,
    };
  }

  @Get("me")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Current admin session" })
  me(@Req() req: AdminRequest) {
    return { email: req.admin?.sub, role: "admin", mfa: this.auth.mfaStatus().enabled };
  }

  @Get("mfa")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Is two-step verification on?" })
  mfa() {
    return this.auth.mfaStatus();
  }

  @Post("mfa/setup")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Start turning 2FA on: returns a secret to add to an authenticator app" })
  mfaSetup(@Req() req: AdminRequest) {
    return this.auth.beginMfaSetup(req.admin?.sub ?? "admin");
  }

  @Post("mfa/enable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Finish turning 2FA on by entering a current code" })
  mfaEnable(@Body() dto: MfaCodeDto) {
    this.auth.enableMfa(dto.code);
    return this.auth.mfaStatus();
  }

  @Post("mfa/disable")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Turn 2FA off (needs the password and a current code)" })
  async mfaDisable(@Body() dto: MfaDisableDto) {
    await this.auth.disableMfa(dto.password, dto.code);
    return this.auth.mfaStatus();
  }

  @Post("password")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Change the admin password (needs the current password)" })
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AdminRequest) {
    await this.auth.changePassword(dto.currentPassword, dto.newPassword, req.ip ?? "ip");
    return { success: true };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "End the admin session" })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE, this.cookieOpts());
    return { success: true };
  }
}

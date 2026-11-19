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
import { IsEmail, IsNotEmpty, IsString, Matches } from "class-validator";
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

  @Matches(/^\d{6}$/, { message: "code must be the 6-digit authenticator code" })
  code!: string;
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
  @ApiOperation({ summary: "Admin login: email + password + TOTP code (sets an HttpOnly cookie)" })
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
    return { email: req.admin?.sub, role: "admin", mfa: true };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "End the admin session" })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ADMIN_COOKIE, this.cookieOpts());
    return { success: true };
  }
}

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AppConfigService } from "../config/config.service";
import { AuthService } from "./auth.service";
import {
  REFRESH_COOKIE,
  clearSessionCookies,
  isWebClient,
  readCookie,
  setSessionCookies,
} from "./session-cookies";
import type { AuthTokens } from "./token.service";
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from "./dto/auth.dto";

@ApiTags("Authentication")
@Controller("v1/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: AppConfigService
  ) {}

  /**
   * Browsers (header `X-MJDM-Client: web`) get their tokens as HttpOnly cookies and never see
   * them in the JSON body; native clients keep receiving the token pair in the body.
   */
  private respond<T extends { tokens: AuthTokens }>(req: Request, res: Response, result: T) {
    if (!isWebClient(req)) return result;
    setSessionCookies(res, result.tokens, this.config.isProduction);
    const { tokens, ...rest } = result;
    return { ...rest, expiresInSeconds: tokens.expiresInSeconds };
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || req.ip || "127.0.0.1";
  }

  @Post("register")
  @ApiOperation({ summary: "Register a new user account" })
  @ApiResponse({ status: 201, description: "User registered successfully" })
  @ApiResponse({ status: 409, description: "Email already registered" })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = this.extractIp(req);
    return this.respond(req, res, await this.authService.register(dto, ip));
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Login with email & password" })
  @ApiResponse({ status: 200, description: "Logged in, token pair returned" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = this.extractIp(req);
    return this.respond(req, res, await this.authService.login(dto, ip));
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rotate refresh token and get a new access token" })
  @ApiResponse({ status: 200, description: "New token pair issued" })
  @ApiResponse({ status: 401, description: "Invalid or revoked refresh token" })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const ip = this.extractIp(req);
    const token = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    if (!token) {
      throw new UnauthorizedException("Missing refresh token");
    }
    const tokens = await this.authService.refresh(token, ip);
    if (!isWebClient(req)) return tokens;
    setSessionCookies(res, tokens, this.config.isProduction);
    return { expiresInSeconds: tokens.expiresInSeconds };
  }

  @Post("logout")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke refresh token" })
  @ApiResponse({ status: 200, description: "Token revoked" })
  async logout(
    @Body() dto: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const token = dto.refreshToken ?? readCookie(req, REFRESH_COOKIE);
    clearSessionCookies(res, this.config.isProduction);
    if (!token) {
      return { success: true };
    }
    return this.authService.logout(token);
  }

  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verify email address via token" })
  @ApiResponse({ status: 200, description: "Email verified" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post("forgot-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Request password reset token" })
  @ApiResponse({ status: 200, description: "Instructions sent" })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const ip = this.extractIp(req);
    return this.authService.forgotPassword(dto, ip);
  }

  @Post("reset-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reset password using reset token" })
  @ApiResponse({ status: 200, description: "Password reset successfully" })
  @ApiResponse({ status: 400, description: "Invalid or expired token" })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }
}

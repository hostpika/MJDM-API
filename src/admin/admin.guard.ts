import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { readCookie } from "../auth/session-cookies";
import { AppConfigService } from "../config/config.service";
import { ADMIN_COOKIE, AdminAuthService, type AdminSession } from "./admin-auth.service";

export type AdminRequest = Request & { admin?: AdminSession };
const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Requires a valid admin session (cookie or Bearer). Cookie-authenticated writes also need CSRF proof. */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: AppConfigService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const bearer = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7).trim()
      : undefined;
    const cookie = readCookie(req, ADMIN_COOKIE);
    req.admin = this.auth.verify(bearer ?? cookie ?? "");

    if (!bearer && UNSAFE.has(req.method)) {
      const origin = req.headers.origin;
      if (
        req.headers["x-mjdm-client"] !== "web" ||
        (origin && !this.config.corsOrigins.includes(origin))
      ) {
        throw new ForbiddenException("Cross-site request blocked (CSRF protection)");
      }
    }
    return true;
  }
}

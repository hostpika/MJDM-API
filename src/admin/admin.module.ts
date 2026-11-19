import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { LicensesModule } from "../licenses/licenses.module";
import { PasswordService } from "../auth/password.service";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { SiteContentService } from "../site/site-content.service";
import { SiteController } from "../site/site.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

@Module({
  imports: [LicensesModule, BillingModule],
  controllers: [AdminController, AdminAuthController, SiteController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    PasswordService,
    RateLimiterService,
    SiteContentService,
  ],
  exports: [AdminService],
})
export class AdminModule {}

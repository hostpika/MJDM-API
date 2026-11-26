import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { LicensesModule } from "../licenses/licenses.module";
import { PasswordService } from "../auth/password.service";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { PaymentsModule } from "../payments/payments.module";
import { SettingsModule } from "../settings/settings.module";
import { SiteModule } from "../site/site.module";
import { SiteController } from "../site/site.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminController } from "./admin.controller";
import { AdminLicensesController } from "./admin-licenses.controller";
import { AdminManageController } from "./admin-manage.controller";
import { AdminPaymentsController } from "./admin-payments.controller";
import { AdminSettingsController } from "./admin-settings.controller";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";
import { ReleasesService } from "./releases.service";

@Module({
  imports: [LicensesModule, BillingModule, PaymentsModule, SiteModule, SettingsModule],
  controllers: [AdminController, AdminAuthController, AdminLicensesController, AdminPaymentsController, AdminManageController, AdminSettingsController, SiteController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminGuard,
    PasswordService,
    RateLimiterService,
    ReleasesService,
  ],
  exports: [AdminService],
})
export class AdminModule {}

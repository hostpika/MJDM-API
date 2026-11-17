import { Module } from "@nestjs/common";
import { AccountModule } from "./account/account.module";
import { AdminModule } from "./admin/admin.module";
import { AuthModule } from "./auth/auth.module";
import { BillingModule } from "./billing/billing.module";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { LicensesModule } from "./licenses/licenses.module";
import { ObservabilityModule } from "./observability/observability.module";
import { SyncModule } from "./sync/sync.module";
import { UpdatesModule } from "./updates/updates.module";

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ObservabilityModule,
    HealthModule,
    AuthModule,
    AccountModule,
    LicensesModule,
    BillingModule,
    UpdatesModule,
    AdminModule,
    SyncModule,
  ],
})
export class AppModule {}

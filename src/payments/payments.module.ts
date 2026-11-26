import { Module } from "@nestjs/common";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { LicensesModule } from "../licenses/licenses.module";
import { SiteModule } from "../site/site.module";
import { PayController } from "./pay.controller";
import { PaymentsService } from "./payments.service";
import { PaymentsStore } from "./payments.store";

@Module({
  imports: [LicensesModule, SiteModule],
  controllers: [PayController],
  providers: [PaymentsService, PaymentsStore, RateLimiterService],
  exports: [PaymentsService],
})
export class PaymentsModule {}

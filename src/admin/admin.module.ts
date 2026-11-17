import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { LicensesModule } from "../licenses/licenses.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [LicensesModule, BillingModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}

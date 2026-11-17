import { Module } from "@nestjs/common";
import { Es256Service } from "./es256.service";
import { LicensesController } from "./licenses.controller";
import { LicensesService } from "./licenses.service";

@Module({
  controllers: [LicensesController],
  providers: [LicensesService, Es256Service],
  exports: [LicensesService, Es256Service],
})
export class LicensesModule {}

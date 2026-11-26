import { Module } from "@nestjs/common";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { AppController } from "./app.controller";
import { AppSettingsService } from "./app-settings.service";
import { MailService } from "./mail.service";
import { TrialsService } from "./trials.service";

/** Admin-editable settings, email sending and the free trial. One shared instance of each. */
@Module({
  controllers: [AppController],
  providers: [AppSettingsService, MailService, TrialsService, RateLimiterService],
  exports: [AppSettingsService, MailService, TrialsService],
})
export class SettingsModule {}

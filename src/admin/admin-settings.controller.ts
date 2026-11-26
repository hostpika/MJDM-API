import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MailService } from "../settings/mail.service";
import { TrialsService } from "../settings/trials.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { AdminService } from "./admin.service";

export class AppSettingsDto {
  /** Days of free use before a license is needed. 0 = no trial. */
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays!: number;
}

export class SmtpDto {
  @IsString()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsBoolean()
  secure!: boolean;

  @IsString()
  @MaxLength(255)
  user!: string;

  /** Leave empty to keep the saved password. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;

  @IsString()
  @MaxLength(100)
  fromName!: string;

  @IsEmail()
  @MaxLength(255)
  fromEmail!: string;
}

export class TestEmailDto {
  @IsEmail()
  @MaxLength(255)
  to!: string;
}

/** Trial length and the email (SMTP) account. */
@ApiTags("Admin Settings")
@UseGuards(AdminGuard)
@Controller("v1/admin")
export class AdminSettingsController {
  constructor(
    private readonly trials: TrialsService,
    private readonly mail: MailService,
    private readonly admin: AdminService
  ) {}

  @Get("app-settings")
  @ApiOperation({ summary: "Trial length" })
  async appSettings() {
    return { trialDays: await this.trials.trialDays() };
  }

  @Put("app-settings")
  @ApiOperation({ summary: "Set the trial length (applies to every computer, including running trials)" })
  async setAppSettings(@Body() dto: AppSettingsDto, @Req() req: AdminRequest) {
    const by = req.admin?.sub ?? "admin";
    const trialDays = await this.trials.setTrialDays(dto.trialDays, by);
    await this.admin.recordAudit(by, "settings.trial", "settings", "app", { trialDays }, req.ip);
    return { trialDays };
  }

  @Get("email")
  @ApiOperation({ summary: "Email (SMTP) settings. The password is never returned." })
  email() {
    return this.mail.view();
  }

  @Put("email")
  @ApiOperation({ summary: "Save the email (SMTP) account" })
  async saveEmail(@Body() dto: SmtpDto, @Req() req: AdminRequest) {
    const by = req.admin?.sub ?? "admin";
    const view = await this.mail.save(dto, by);
    await this.admin.recordAudit(by, "settings.email", "settings", "smtp", { host: view.host, user: view.user }, req.ip);
    return view;
  }

  @Post("email/test")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Send a test email to check the SMTP account" })
  async testEmail(@Body() dto: TestEmailDto) {
    await this.mail.sendTest(dto.to);
    return { sent: true, to: dto.to };
  }
}

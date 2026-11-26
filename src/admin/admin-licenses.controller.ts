import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from "class-validator";
import { LicensesService } from "../licenses/licenses.service";
import { MailService } from "../settings/mail.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { AdminService } from "./admin.service";

export class IssueLicenseDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsString()
  @MaxLength(100)
  planId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Email the key to the customer right away (needs the SMTP account set up). */
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;
}

@ApiTags("Admin Licenses")
@UseGuards(AdminGuard)
@Controller("v1/admin/licenses")
export class AdminLicensesController {
  constructor(
    private readonly licenses: LicensesService,
    private readonly admin: AdminService,
    private readonly mail: MailService
  ) {}

  @Get("plans")
  @ApiOperation({ summary: "Plans a license can be issued for" })
  plans() {
    return this.licenses.getPlans();
  }

  @Get()
  @ApiOperation({ summary: "All licenses with customer, plan and device usage (no keys)" })
  list() {
    return this.licenses.listLicensesForAdmin();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Issue a license by hand. The key is returned once and is never stored in plain text.",
  })
  async issue(@Body() dto: IssueLicenseDto, @Req() req: AdminRequest) {
    const admin = req.admin?.sub ?? "admin";
    const { sendEmail, ...rest } = dto;
    const made = await this.licenses.issueManualLicense({ ...rest, issuedBy: admin });
    await this.admin.recordAudit(
      admin,
      "license.issue",
      "license",
      made.licenseId,
      { email: made.email, plan: made.plan.id, source: "manual" },
      req.ip
    );
    // The license exists either way; a mail problem is reported, not fatal.
    let emailed: { ok: boolean; error?: string } | undefined;
    if (sendEmail) {
      try {
        await this.mail.sendLicense({ to: made.email, name: dto.name, key: made.key, planName: made.plan.name, expiresAt: null });
        await this.admin.recordAudit(admin, "license.email", "license", made.licenseId, { to: made.email }, req.ip);
        emailed = { ok: true };
      } catch (e) {
        emailed = { ok: false, error: e instanceof Error ? e.message : "The email could not be sent." };
      }
    }
    return { licenseId: made.licenseId, key: made.key, email: made.email, plan: made.plan, emailed };
  }

  @Get(":id/key")
  @ApiOperation({ summary: "Show a license key again (admin only, recorded in the audit log)" })
  async reveal(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    const r = await this.licenses.revealKey(id);
    await this.admin.recordAudit(req.admin?.sub ?? "admin", "license.reveal", "license", id, { email: r.email }, req.ip);
    return { key: r.key, email: r.email };
  }

  @Post(":id/email")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Email the license key to the customer" })
  async email(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    const r = await this.licenses.revealKey(id);
    await this.mail.sendLicense({ to: r.email, name: r.name, key: r.key, planName: r.planName, expiresAt: r.expiresAt });
    await this.admin.recordAudit(req.admin?.sub ?? "admin", "license.email", "license", id, { to: r.email }, req.ip);
    return { sent: true, to: r.email };
  }

  @Post(":id/revoke")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Revoke a license and every device activation under it" })
  async revoke(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    const admin = req.admin?.sub ?? "admin";
    const result = await this.licenses.revokeLicense(id);
    await this.admin.recordAudit(admin, "license.revoke", "license", id, {}, req.ip);
    return result;
  }
}

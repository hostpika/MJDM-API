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
import { IsEmail, IsOptional, IsString, MaxLength } from "class-validator";
import { LicensesService } from "../licenses/licenses.service";
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
}

@ApiTags("Admin Licenses")
@UseGuards(AdminGuard)
@Controller("v1/admin/licenses")
export class AdminLicensesController {
  constructor(
    private readonly licenses: LicensesService,
    private readonly admin: AdminService
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
    const made = await this.licenses.issueManualLicense({ ...dto, issuedBy: admin });
    await this.admin.recordAudit(
      admin,
      "license.issue",
      "license",
      made.licenseId,
      { email: made.email, plan: made.plan.id, source: "manual" },
      req.ip
    );
    return { licenseId: made.licenseId, key: made.key, email: made.email, plan: made.plan };
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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { Request } from "express";
import { LicensesService } from "../licenses/licenses.service";
import { AdminGuard, type AdminRequest } from "./admin.guard";
import { AdminService } from "./admin.service";
import { ReleasesService } from "./releases.service";

export class PublishReleaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Customers, devices and releases for the admin panel. */
@ApiTags("Admin")
@UseGuards(AdminGuard)
@Controller("v1/admin")
export class AdminManageController {
  constructor(
    private readonly licenses: LicensesService,
    private readonly releases: ReleasesService,
    private readonly admin: AdminService
  ) {}

  @Get("customers")
  @ApiOperation({ summary: "Customers with their licenses, devices and paid orders" })
  customers(@Query("q") q?: string) {
    return this.licenses.listCustomersForAdmin(q);
  }

  @Get("devices")
  @ApiOperation({ summary: "Devices that activated a license" })
  devices() {
    return this.licenses.listDevicesForAdmin();
  }

  @Post("devices/:id/deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Free every license slot a device uses" })
  async deactivate(@Param("id", new ParseUUIDPipe()) id: string, @Req() req: AdminRequest) {
    const result = await this.licenses.adminDeactivateDevice(id);
    await this.admin.recordAudit(req.admin?.sub ?? "admin", "device.deactivate", "device", id, result, req.ip);
    return result;
  }

  @Get("releases")
  @ApiOperation({ summary: "Installers on the server and which one apps and the website use" })
  list() {
    return this.releases.list();
  }

  @Post("releases/upload")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Upload an installer (.exe) or its signature (.sig) as raw bytes; ?name=MJDM_1.0.5_x64-setup.exe" })
  async upload(@Query("name") name: string, @Req() req: Request & { body: Buffer } & AdminRequest) {
    const saved = this.releases.save(String(name ?? ""), req.body);
    await this.admin.recordAudit(req.admin?.sub ?? "admin", "release.upload", "release", undefined, saved, req.ip);
    return saved;
  }

  @Post("releases/:version/publish")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Make a version the one apps update to and the website offers" })
  async publish(@Param("version") version: string, @Body() dto: PublishReleaseDto, @Req() req: AdminRequest) {
    const row = await this.releases.publish(version, dto.notes, req.admin?.sub ?? "admin");
    await this.admin.recordAudit(req.admin?.sub ?? "admin", "release.publish", "release", undefined, { version }, req.ip);
    return row;
  }
}

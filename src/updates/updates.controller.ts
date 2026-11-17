import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CheckUpdateParamsDto, PublishReleaseDto } from "./dto/updates.dto";
import { UpdatesService } from "./updates.service";

@ApiTags("Updates & Releases")
@Controller("v1/updates")
export class UpdatesController {
  constructor(private readonly updatesService: UpdatesService) {}

  @Get("releases")
  @ApiOperation({ summary: "List all published application releases" })
  @ApiQuery({ name: "channel", enum: ["stable", "beta"], required: false })
  @ApiResponse({ status: 200, description: "Releases list" })
  async listReleases(@Query("channel") channel?: "stable" | "beta") {
    return this.updatesService.listReleases(channel);
  }

  @Post("releases")
  @ApiOperation({ summary: "Publish a new application release artifact (Admin / CI)" })
  @ApiResponse({ status: 201, description: "Release published" })
  async publishRelease(@Body() dto: PublishReleaseDto) {
    return this.updatesService.publishRelease(dto);
  }

  @Get(":target/:arch/:currentVersion")
  @ApiOperation({
    summary: "Tauri-compatible updater endpoint returning update manifest or 204 No Content",
  })
  @ApiQuery({ name: "channel", enum: ["stable", "beta"], required: false })
  @ApiQuery({ name: "install_uuid", required: false })
  @ApiResponse({ status: 200, description: "Update available (JSON manifest)" })
  @ApiResponse({ status: 204, description: "No update available (Up to date or cohort skipped)" })
  async checkUpdate(
    @Param() params: CheckUpdateParamsDto,
    @Query("channel") channel: "stable" | "beta" = "stable",
    @Query("install_uuid") installUuid: string | undefined,
    @Res() res: Response
  ) {
    const update = await this.updatesService.checkUpdate(
      params.target,
      params.arch,
      params.currentVersion,
      channel,
      installUuid
    );

    if (!update) {
      return res.status(HttpStatus.NO_CONTENT).send();
    }
    return res.status(HttpStatus.OK).json(update);
  }
}

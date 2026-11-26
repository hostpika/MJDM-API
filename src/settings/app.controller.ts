import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Request } from "express";
import { RateLimiterService } from "../auth/rate-limiter.service";
import { TrialsService } from "./trials.service";

export class StartTrialDto {
  @IsUUID()
  deviceUuid!: string;

  /** A hash of this computer's id, so wiping the app's data does not restart the trial. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  machineId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  appVersion?: string;
}

/** What the desktop app asks before anyone has a license. */
@ApiTags("App")
@Controller("v1")
export class AppController {
  constructor(
    private readonly trials: TrialsService,
    private readonly limiter: RateLimiterService
  ) {}

  @Get("app/config")
  @ApiOperation({ summary: "Public app settings (trial length)" })
  async config() {
    return { trialDays: await this.trials.trialDays(), serverNow: new Date().toISOString() };
  }

  @Post("trials/start")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Start (or look up) this computer's free trial" })
  async start(@Body() dto: StartTrialDto, @Req() req: Request) {
    this.limiter.check(`trial:${req.ip}`, 30, 60_000);
    return this.trials.start(dto);
  }
}

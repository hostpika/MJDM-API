import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { DatabaseService } from "../database/database.service";

@ApiTags("Health")
@Controller("health")
export class HealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get("live")
  @ApiOperation({ summary: "Liveness probe: verifies process is alive and responsive" })
  @ApiResponse({ status: 200, description: "Process is live" })
  getLiveness() {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      memory: process.memoryUsage(),
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "Readiness probe: verifies dependencies (DB, services) are ready" })
  @ApiResponse({ status: 200, description: "Service is ready to handle traffic" })
  @ApiResponse({ status: 503, description: "Service dependencies are unavailable" })
  getReadiness(@Res() res: Response) {
    const isDbConnected = this.db.connected;
    const body = {
      status: isDbConnected ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: {
        database: isDbConnected ? "connected" : "disconnected",
      },
    };

    if (isDbConnected) {
      return res.status(HttpStatus.OK).json(body);
    }
    // In standalone/development mode without active DB, return 200 with degraded note for testing,
    // or 503 if strict production
    const isProd = process.env.NODE_ENV === "production";
    return res.status(isProd ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.OK).json(body);
  }
}

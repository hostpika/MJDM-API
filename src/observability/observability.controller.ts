import { Controller, Get, Header, Res } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { MetricsService } from "./metrics.service";

@ApiTags("Observability")
@Controller()
export class ObservabilityController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("metrics")
  @ApiOperation({ summary: "Prometheus scraping endpoint" })
  @ApiResponse({ status: 200, description: "Prometheus exposition format metrics" })
  async getMetrics(@Res() res: Response) {
    const metrics = await this.metricsService.getMetrics();
    res.setHeader("Content-Type", this.metricsService.getContentType());
    res.send(metrics);
  }
}

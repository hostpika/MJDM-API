import { Global, Module } from "@nestjs/common";
import { ErrorTrackingService } from "./error-tracking.service";
import { MetricsService } from "./metrics.service";
import { ObservabilityController } from "./observability.controller";

@Global()
@Module({
  controllers: [ObservabilityController],
  providers: [MetricsService, ErrorTrackingService],
  exports: [MetricsService, ErrorTrackingService],
})
export class ObservabilityModule {}

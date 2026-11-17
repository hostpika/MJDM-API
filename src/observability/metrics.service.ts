import { Injectable, OnModuleInit } from "@nestjs/common";
import * as client from "prom-client";

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry = new client.Registry();

  public readonly httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total number of HTTP requests processed by cloud-api",
    labelNames: ["method", "route", "status_code"],
    registers: [this.registry],
  });

  public readonly httpRequestDuration = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "Histogram of HTTP request durations in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  public readonly httpErrorsTotal = new client.Counter({
    name: "http_errors_total",
    help: "Total number of HTTP error responses (4xx, 5xx)",
    labelNames: ["method", "route", "status_code"],
    registers: [this.registry],
  });

  public readonly activeConnections = new client.Gauge({
    name: "http_active_connections",
    help: "Current number of in-flight active HTTP requests",
    registers: [this.registry],
  });

  onModuleInit() {
    // Collect standard process and Node.js metrics (CPU, memory, event loop lag)
    client.collectDefaultMetrics({ register: this.registry, prefix: "mjdm_" });
  }

  recordRequest(method: string, route: string, statusCode: number, durationSeconds: number) {
    const status = statusCode.toString();
    this.httpRequestsTotal.inc({ method, route, status_code: status });
    this.httpRequestDuration.observe({ method, route, status_code: status }, durationSeconds);
    if (statusCode >= 400) {
      this.httpErrorsTotal.inc({ method, route, status_code: status });
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}

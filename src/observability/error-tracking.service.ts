import { Injectable, Logger } from "@nestjs/common";
import { redactSensitiveData } from "./redaction.util";

export interface Breadcrumb {
  category: string;
  message: string;
  level: "info" | "warning" | "error";
  data?: Record<string, unknown>;
  timestamp: string;
}

export interface CapturedError {
  id: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  breadcrumbs: Breadcrumb[];
  timestamp: string;
}

@Injectable()
export class ErrorTrackingService {
  private readonly logger = new Logger(ErrorTrackingService.name);
  private readonly breadcrumbs: Breadcrumb[] = [];
  private readonly capturedErrors: CapturedError[] = [];

  addBreadcrumb(category: string, message: string, data?: Record<string, unknown>, level: "info" | "warning" | "error" = "info") {
    const sanitizedData = data ? (redactSensitiveData(data) as Record<string, unknown>) : undefined;
    const item: Breadcrumb = {
      category,
      message,
      level,
      data: sanitizedData,
      timestamp: new Date().toISOString(),
    };
    this.breadcrumbs.push(item);
    if (this.breadcrumbs.length > 50) {
      this.breadcrumbs.shift();
    }
  }

  captureException(error: Error, context?: Record<string, unknown>): string {
    const errorId = `err_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sanitizedContext = context ? (redactSensitiveData(context) as Record<string, unknown>) : undefined;

    const entry: CapturedError = {
      id: errorId,
      message: error.message,
      stack: error.stack,
      context: sanitizedContext,
      breadcrumbs: [...this.breadcrumbs],
      timestamp: new Date().toISOString(),
    };

    this.capturedErrors.unshift(entry);
    if (this.capturedErrors.length > 100) {
      this.capturedErrors.pop();
    }

    this.logger.error(
      `[${errorId}] ${error.message}`,
      JSON.stringify({ context: sanitizedContext, stack: error.stack?.split("\n").slice(0, 3) })
    );

    return errorId;
  }

  getRecentErrors(): CapturedError[] {
    return [...this.capturedErrors];
  }
}

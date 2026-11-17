import { describe, expect, it } from "vitest";
import { ErrorTrackingService } from "../src/observability/error-tracking.service";
import { MetricsService } from "../src/observability/metrics.service";
import { redactSensitiveData } from "../src/observability/redaction.util";

describe("P10-T09: Observability, Metrics & Secret Redaction (cloud-api)", () => {
  it("should collect HTTP metrics and expose Prometheus text format", async () => {
    const metricsService = new MetricsService();
    metricsService.onModuleInit();

    // Record some simulated traffic
    metricsService.recordRequest("GET", "/v1/licenses/plans", 200, 0.045);
    metricsService.recordRequest("POST", "/v1/auth/login", 200, 0.12);
    metricsService.recordRequest("POST", "/v1/auth/login", 401, 0.08);

    const metricsText = await metricsService.getMetrics();
    expect(metricsText).toContain("http_requests_total");
    expect(metricsText).toContain("http_request_duration_seconds");
    expect(metricsText).toContain("http_errors_total");
    expect(metricsText).toContain('route="/v1/auth/login"');
    expect(metricsText).toContain('status_code="401"');
  });

  it("should thoroughly redact passwords, auth tokens, and secrets from logs and contexts", () => {
    const rawContext = {
      user: {
        id: "usr_123",
        email: "meraj@example.com",
        password: "SuperSecretPassword123!",
        currentPassword: "OldPassword123!",
      },
      headers: {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secretpayload",
        cookie: "session_id=abcdef123456",
        "content-type": "application/json",
      },
      secrets: {
        jwt_secret: "my_ultra_secret_key_32_chars_long",
        server_pepper: "random_pepper_value_32_chars_long",
        license_key: "MJDM-XXXXX-XXXXX-XXXXX-XXXXX",
      },
    };

    const sanitized = redactSensitiveData(rawContext) as typeof rawContext;

    expect(sanitized.user.email).toBe("meraj@example.com");
    expect(sanitized.user.password).toBe("[REDACTED]");
    expect(sanitized.user.currentPassword).toBe("[REDACTED]");
    expect(sanitized.headers.authorization).toBe("Bearer [REDACTED]");
    expect(sanitized.headers.cookie).toBe("[REDACTED]");
    expect(sanitized.headers["content-type"]).toBe("application/json");
    expect(sanitized.secrets.jwt_secret).toBe("[REDACTED]");
    expect(sanitized.secrets.server_pepper).toBe("[REDACTED]");
    expect(sanitized.secrets.license_key).toBe("[REDACTED]");
  });

  it("should capture exceptions with breadcrumbs and sanitized context", () => {
    const errorTracker = new ErrorTrackingService();

    errorTracker.addBreadcrumb("auth", "User attempted login", {
      email: "test@example.com",
      password: "AttemptPassword",
    });

    const testError = new Error("Database timeout during checkout");
    const errorId = errorTracker.captureException(testError, {
      checkoutId: "chk_999",
      token: "secret_token_123",
    });

    expect(errorId.startsWith("err_")).toBe(true);
    const recent = errorTracker.getRecentErrors();
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].id).toBe(errorId);
    expect(recent[0].message).toBe("Database timeout during checkout");
    expect(recent[0].context?.token).toBe("[REDACTED]");
    expect(recent[0].breadcrumbs[0].data?.password).toBe("[REDACTED]");
  });
});

import "reflect-metadata";
import * as fs from "node:fs";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { raw } from "express";
import type { Request, Response } from "express";
import { AppModule } from "./app.module";
import { sessionCookieMiddleware } from "./auth/session-cookies";
import { AppConfigService } from "./config/config.service";

export async function createNestApp() {
  const app = await NestFactory.create(AppModule, {
    // Stripe signs the exact bytes it sends, so the raw body is kept next to the parsed one.
    rawBody: true,
    logger: ["error", "warn", "log"],
  });

  const config = app.get(AppConfigService);

  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
  });

  // Cookie sessions for browsers (+ CSRF check); see auth/session-cookies.ts
  app.use(sessionCookieMiddleware(config.corsOrigins));

  // Installer uploads from the admin panel arrive as raw bytes on this one route only.
  app.use("/v1/admin/releases/upload", raw({ type: "application/octet-stream", limit: "85mb" }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("MJDM Cloud Platform API")
    .setDescription(
      "High-performance cloud licensing, update management, E2EE sync, and customer backend for MJ Download Manager."
    )
    .setVersion("1.0.0")
    .addBearerAuth({
      type: "http",
      scheme: "bearer",
      bearerFormat: "JWT",
      description: "Enter access token",
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Serve Swagger UI at /docs
  SwaggerModule.setup("docs", app, document);

  // Expose raw OpenAPI JSON at /api/openapi.json
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get("/api/openapi.json", (_req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(document, null, 2));
  });

  return { app, config, document };
}

async function bootstrap() {
  // Load ./.env if present (real environment variables win). Built into Node 22, no dependency.
  if (fs.existsSync(".env")) {
    const before = { ...process.env };
    process.loadEnvFile(".env");
    for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
  }
  const { app, config } = await createNestApp();
  const port = config.get("PORT");
  await app.listen(port);
  console.log(`[MJDM Cloud API] Server listening on http://localhost:${port}`);
  console.log(`[MJDM Cloud API] OpenAPI documentation available at http://localhost:${port}/docs`);
}

if (require.main === module) {
  bootstrap().catch((err) => {
    console.error("[MJDM Cloud API] Failed to start:", err);
    process.exit(1);
  });
}

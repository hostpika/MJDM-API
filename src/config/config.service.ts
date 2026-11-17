import { Injectable } from "@nestjs/common";
import { EnvConfig, validateEnv } from "./env.schema";

@Injectable()
export class AppConfigService {
  private readonly config: EnvConfig;

  constructor() {
    this.config = validateEnv(process.env);
  }

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === "production";
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === "test";
  }

  get corsOrigins(): string[] {
    return this.config.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

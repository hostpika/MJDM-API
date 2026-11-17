import { z } from "zod";

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/mjdm_cloud"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters long")
    .default("mjdm_default_jwt_secret_must_be_32_characters_minimum!"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters long")
    .default("mjdm_default_refresh_secret_must_be_32_characters_min!"),
  SERVER_PEPPER: z
    .string()
    .min(32, "SERVER_PEPPER must be at least 32 characters long")
    .default("mjdm_server_pepper_for_license_hmac_32_chars_min!"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:5173"),
  ES256_PRIVATE_KEY_PEM: z.string().optional(),
  ES256_PUBLIC_KEY_PEM: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

const SECRET_KEYS = ["JWT_SECRET", "JWT_REFRESH_SECRET", "SERVER_PEPPER"] as const;

export function validateEnv(rawEnv: Record<string, unknown> = process.env): EnvConfig {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - [${i.path.join(".")}]: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // The built-in defaults are public (they are in the source). Never start a production server
  // that would sign tokens or hash licenses with them.
  if (parsed.data.NODE_ENV === "production") {
    const defaults = envSchema.parse({ NODE_ENV: "development" });
    const unsafe = SECRET_KEYS.filter((k) => !rawEnv[k] || parsed.data[k] === defaults[k]);
    if (unsafe.length > 0) {
      throw new Error(
        `Refusing to start in production with default or missing secrets: ${unsafe.join(", ")}. ` +
          "Generate unique random values of at least 32 characters (e.g. `openssl rand -hex 48`)."
      );
    }
  }
  return parsed.data;
}

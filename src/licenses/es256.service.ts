import * as crypto from "node:crypto";
import { Inject, Injectable, OnModuleInit, Optional } from "@nestjs/common";
import { AppConfigService } from "../config/config.service";

export interface LicenseTokenClaims {
  iss: string;
  sub: string; // licenseId
  did: string; // deviceUuid
  plan: string;
  max_devices: number;
  features: string[];
  iat: number;
  exp: number;
  grace_exp: number;
  kid: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf-8") : input;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

@Injectable()
export class Es256Service implements OnModuleInit {
  private privateKeyPem!: string;
  private publicKeyPem!: string;
  public readonly keyId = "mjdm-es256-v1";

  constructor(
    @Optional()
    @Inject(AppConfigService)
    private readonly config?: AppConfigService
  ) {}

  onModuleInit(): void {
    const configPriv =
      this.config?.get("ES256_PRIVATE_KEY_PEM") ?? process.env.ES256_PRIVATE_KEY_PEM;
    const configPub =
      this.config?.get("ES256_PUBLIC_KEY_PEM") ?? process.env.ES256_PUBLIC_KEY_PEM;

    if (configPriv && configPub) {
      this.privateKeyPem = configPriv;
      this.publicKeyPem = configPub;
    } else {
      // Generate EC P-256 key pair automatically if not provided in environment
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });
      this.privateKeyPem = privateKey;
      this.publicKeyPem = publicKey;
    }
  }

  getPublicKey(): string {
    if (!this.publicKeyPem) {
      this.onModuleInit();
    }
    return this.publicKeyPem;
  }

  /**
   * Signs license claims into an ES256 JWS compact token:
   * base64url(header).base64url(payload).base64url(signature)
   */
  signToken(claims: Omit<LicenseTokenClaims, "iss" | "kid">): string {
    if (!this.privateKeyPem) {
      this.onModuleInit();
    }

    const header = {
      alg: "ES256",
      typ: "JWT",
      kid: this.keyId,
    };

    const fullClaims: LicenseTokenClaims = {
      ...claims,
      iss: "https://api.mjdm.app",
      kid: this.keyId,
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(fullClaims));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const sign = crypto.createSign("SHA256");
    sign.update(signingInput);
    sign.end();

    const signatureDer = sign.sign(this.privateKeyPem);
    const encodedSignature = base64url(signatureDer);

    return `${signingInput}.${encodedSignature}`;
  }

  /**
   * Verifies an ES256 JWS compact token using the public key.
   */
  verifyToken(token: string): { valid: boolean; claims?: LicenseTokenClaims; error?: string } {
    if (!this.publicKeyPem) {
      this.onModuleInit();
    }

    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return { valid: false, error: "Malformed JWS token: expected 3 segments" };
      }

      const [encodedHeader, encodedPayload, encodedSignature] = parts;
      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const signatureDer = base64urlDecode(encodedSignature);

      const verify = crypto.createVerify("SHA256");
      verify.update(signingInput);
      verify.end();

      const isValidSignature = verify.verify(this.publicKeyPem, signatureDer);
      if (!isValidSignature) {
        return { valid: false, error: "Invalid ES256 cryptographic signature" };
      }

      const payloadStr = base64urlDecode(encodedPayload).toString("utf-8");
      const claims = JSON.parse(payloadStr) as LicenseTokenClaims;

      const nowSec = Math.floor(Date.now() / 1000);
      if (claims.grace_exp < nowSec) {
        return { valid: false, claims, error: "License token and grace period expired" };
      }

      return { valid: true, claims };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { valid: false, error: `Verification error: ${msg}` };
    }
  }
}

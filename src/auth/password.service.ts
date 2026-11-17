import { Injectable } from "@nestjs/common";
import * as argon2 from "@node-rs/argon2";

@Injectable()
export class PasswordService {
  /**
   * Hashes a plaintext password using Argon2id with OWASP-recommended parameters
   */
  async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      memoryCost: 65536, // 64 MiB
      timeCost: 3,
      parallelism: 4,
      algorithm: argon2.Algorithm.Argon2id,
    });
  }

  /**
   * Verifies a plaintext password against an Argon2id hash
   */
  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }
}

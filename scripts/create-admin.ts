/**
 * Prints the three environment variables that define the admin account.
 *   pnpm create-admin you@example.com
 * The password is read from the ADMIN_PASSWORD env var or prompted from stdin (never an argument,
 * so it does not end up in shell history).
 */
import * as readline from "node:readline";
import { Algorithm, hash } from "@node-rs/argon2";
import { generateTotpSecret, otpauthUri } from "../src/admin/totp";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("usage: pnpm create-admin <email>");
    process.exitCode = 2;
    return;
  }
  const password =
    process.env.ADMIN_PASSWORD ?? (await ask("Choose an admin password (min 12 chars): "));
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exitCode = 2;
    return;
  }
  const passwordHash = await hash(password, {
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
    algorithm: Algorithm.Argon2id,
  });
  const secret = generateTotpSecret();
  console.log("\n# Add these to the API environment (.env):");
  console.log(`ADMIN_EMAIL=${email}`);
  console.log(`ADMIN_PASSWORD_HASH='${passwordHash}'`);
  console.log(`ADMIN_TOTP_SECRET=${secret}`);
  console.log("\n# Add this account to your authenticator app (manual key, or make a QR from the URI):");
  console.log(`Secret: ${secret}`);
  console.log(otpauthUri(secret, email));
}

void main();

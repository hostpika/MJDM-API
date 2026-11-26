import { BadRequestException, Injectable, Logger, Optional } from "@nestjs/common";
import * as nodemailer from "nodemailer";
import { AppConfigService } from "../config/config.service";
import { decryptJson, encryptJson } from "../payments/payment-crypto";
import { AppSettingsService } from "./app-settings.service";

const SMTP_KEY = "smtp";

interface StoredSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  /** Encrypted password (see payment-crypto). Never returned to the browser. */
  passwordEnc: string;
}

export interface SmtpView {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromName: string;
  fromEmail: string;
  passwordSet: boolean;
}

export interface SmtpInput {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Left empty = keep the saved password. */
  password?: string;
  fromName: string;
  fromEmail: string;
}

export interface LicenseMail {
  to: string;
  name?: string | null;
  key: string;
  planName: string;
  expiresAt?: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Sends email through the SMTP account an admin saved in the admin panel. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly settings: AppSettingsService,
    @Optional() private readonly config?: AppConfigService
  ) {}

  private get pepper(): string {
    return (
      this.config?.get("SERVER_PEPPER") ?? process.env.SERVER_PEPPER ?? "mjdm_server_pepper_for_license_hmac_32_chars_min!"
    );
  }

  private async stored(): Promise<StoredSmtp | null> {
    return this.settings.get<StoredSmtp>(SMTP_KEY);
  }

  async view(): Promise<SmtpView> {
    const s = await this.stored();
    return {
      configured: Boolean(s?.host && s.fromEmail),
      host: s?.host ?? "",
      port: s?.port ?? 587,
      secure: s?.secure ?? false,
      user: s?.user ?? "",
      fromName: s?.fromName ?? "MJDM",
      fromEmail: s?.fromEmail ?? "",
      passwordSet: Boolean(s?.passwordEnc),
    };
  }

  async save(input: SmtpInput, by: string): Promise<SmtpView> {
    const old = await this.stored();
    const password = input.password?.length ? input.password : old?.passwordEnc ? (decryptJson<{ p: string }>(old.passwordEnc, this.pepper)?.p ?? "") : "";
    const next: StoredSmtp = {
      host: input.host.trim(),
      port: input.port,
      secure: input.secure,
      user: input.user.trim(),
      fromName: input.fromName.trim() || "MJDM",
      fromEmail: input.fromEmail.trim(),
      passwordEnc: password ? encryptJson({ p: password }, this.pepper) : "",
    };
    await this.settings.set(SMTP_KEY, next, by);
    return this.view();
  }

  async isConfigured(): Promise<boolean> {
    return (await this.view()).configured;
  }

  private async transport() {
    const s = await this.stored();
    if (!s?.host || !s.fromEmail) throw new BadRequestException("Email is not set up yet. Save the SMTP details in Admin → Email first.");
    const pass = s.passwordEnc ? decryptJson<{ p: string }>(s.passwordEnc, this.pepper)?.p : undefined;
    return {
      from: `"${s.fromName.replace(/"/g, "")}" <${s.fromEmail}>`,
      tx: nodemailer.createTransport({
        host: s.host,
        port: s.port,
        secure: s.secure,
        auth: s.user ? { user: s.user, pass: pass ?? "" } : undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      }),
    };
  }

  /** Sends one message. Throws a short, safe sentence on failure (never the password). */
  async send(to: string, subject: string, text: string, html: string): Promise<void> {
    const { from, tx } = await this.transport();
    try {
      await tx.sendMail({ from, to, subject, text, html });
    } catch (err) {
      const code = (err as { code?: string; responseCode?: number })?.code;
      const rc = (err as { responseCode?: number })?.responseCode;
      this.logger.warn(`Email to ${to} failed: ${code ?? rc ?? "error"}`);
      if (code === "EAUTH" || rc === 535) throw new BadRequestException("The mail server refused the username or password.");
      if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "ENOTFOUND")
        throw new BadRequestException("Could not connect to the mail server. Check the host, port and the Secure setting.");
      if (rc && rc >= 500) throw new BadRequestException("The mail server rejected the message (check the From address is allowed).");
      throw new BadRequestException("The email could not be sent.");
    } finally {
      tx.close();
    }
  }

  async sendTest(to: string): Promise<void> {
    await this.send(
      to,
      "MJDM test email",
      "This is a test email from the MJDM admin panel. If you can read it, license emails will work.",
      "<p>This is a test email from the MJDM admin panel. If you can read it, license emails will work.</p>"
    );
  }

  async sendLicense(m: LicenseMail): Promise<void> {
    const hello = m.name?.trim() ? `Hello ${m.name.trim()},` : "Hello,";
    const until = m.expiresAt ? `Valid until ${new Date(m.expiresAt).toLocaleDateString("en-GB")}.` : "This is a lifetime license.";
    const text = [
      hello,
      "",
      `Thank you for choosing MJDM. Here is your ${m.planName} license key:`,
      "",
      m.key,
      "",
      until,
      "",
      "How to use it:",
      "1. Install MJDM from https://mjdm.us if you have not already.",
      "2. Open MJDM, go to Settings → License, paste the key and press Activate.",
      "",
      "Keep this email. If you change computers, remove the license in MJDM first, then activate it on the new one.",
      "",
      "MJDM · https://mjdm.us",
    ].join("\n");
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#0f172a;max-width:520px">
<p>${esc(hello)}</p>
<p>Thank you for choosing MJDM. Here is your <strong>${esc(m.planName)}</strong> license key:</p>
<p style="font-size:20px;font-weight:700;letter-spacing:1px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-family:Consolas,monospace">${esc(m.key)}</p>
<p>${esc(until)}</p>
<p><strong>How to use it</strong></p>
<ol><li>Install MJDM from <a href="https://mjdm.us">mjdm.us</a> if you have not already.</li><li>Open MJDM, go to <em>Settings → License</em>, paste the key and press <em>Activate</em>.</li></ol>
<p style="color:#475569;font-size:13px">Keep this email. If you change computers, remove the license in MJDM first, then activate it on the new one.</p>
</div>`;
    await this.send(m.to, "Your MJDM license key", text, html);
  }
}

# Terms of Service

**Last Updated:** November 16, 2026  
**Application:** MJ Download Manager & Cloud Platform  
**Website:** https://mjdm.app  

## 1. Acceptance of Terms
By creating an account, initiating an order, or accessing MJDM Cloud Sync services, you agree to be bound by these Terms of Service. If you disagree with any part of these terms, you may not use our cloud services.

## 2. Cloud Accounts & Zero-Knowledge Architecture
- **E2EE Guarantee:** MJDM Cloud Sync operates on an audited zero-knowledge cryptographic model. Your download URLs, filenames, and authentication cookies are never sent to or stored on our cloud infrastructure.
- **Passphrase Responsibility:** Your data is encrypted locally using a passphrase and key derivation function (Argon2id). If you lose both your passphrase and your 16-character Emergency Recovery Key, **we cannot recover your data**.
- **Account Quotas:** Free/Pro accounts include cloud storage quotas up to 20,000 encrypted sync records (maximum 64 KiB per individual record).

## 3. Purchases, Payments & Refunds
- **Merchant of Record:** All purchases and subscription billings are processed by our authorized Merchant of Record (Polar or Lemon Squeezy). The Merchant of Record calculates, collects, and remits applicable VAT, GST, and sales taxes.
- **14-Day Money-Back Guarantee:** If you are unsatisfied with MJDM for any reason, you may request a 100% full refund within 14 calendar days of your initial purchase by contacting `support@mjdm.app` or through the customer portal.
- **Revocation upon Refund:** Upon confirmation of a refund or chargeback, the associated license key is automatically revoked and deactivated.

## 4. Fair Use & Prohibited Conduct
You agree not to abuse or overload the cloud synchronization API, execute unauthorized penetration testing against production servers, or attempt to tamper with other users' encrypted collections.

## 5. Termination
You may delete your account and all associated encrypted sync records permanently at any time via the Desktop App Settings or by issuing a `DELETE /v1/sync` request.

# Privacy Policy

**Effective Date:** November 16, 2026  
**Website:** https://mjdm.app  
**Contact:** privacy@mjdm.app  

## 1. Introduction
MJDM ("we", "us", or "our") respects your privacy. Our core philosophy is data minimization and zero unnecessary data collection.

## 2. Information We NEVER Collect
- **Your Download URLs:** We never collect or log the links or URLs of files you download.
- **Your Downloaded Content or Filenames:** We have zero visibility into what files you save.
- **Your Browsing History:** The browser extension does not track or store visited websites.
- **Plaintext Credentials:** Web cookies and site credentials forwarded by the extension stay entirely within your local device memory or are encrypted locally with AES-256-GCM before cloud sync.

## 3. Information We Collect (Cloud Accounts Only)
If you optionally create an account on MJDM Cloud:
- **Email Address:** Used strictly for authentication, magic-link login, license delivery, and critical security notices.
- **Opaque Encrypted Blobs:** Encrypted settings, categories, and queue definitions which are mathematically unreadable to us.
- **Payment Transaction IDs:** Order identifiers provided by our Merchant of Record to manage your active license.

## 4. GDPR & CCPA Compliance
- **Article 17 (Right to Erasure):** You have the absolute right to delete your account and all stored encrypted sync records instantly.
- **Data Portability:** You can export all your unencrypted local settings to standard JSON at any time.
- **No Sale of Personal Data:** We do not sell, rent, or trade your personal information.

## 5. Security & Cryptography
Cloud synchronization payloads are encrypted on the client side using:
- **Argon2id** Key Derivation (64 MiB, 3 iterations, 4 parallelism lanes)
- **AES-256-GCM** authenticated envelope encryption with Associated Authenticated Data (AAD)
- **16-character Crockford Base32** Emergency Recovery Keys

## 6. Updates to this Policy
Any revisions to this policy will be announced on our website and in the desktop changelog.

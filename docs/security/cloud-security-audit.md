# MJDM Cloud Platform — Security Audit & Abuse Defense Review

**Date:** 2026-11-16  
**Auditor:** Antigravity / Gemini Security Reviewer  
**Scope:** `backend`, `admin`, `frontend/portal`  
**Reference:** Master Plan §12.9, §16 (P10-T10), OWASP API Security Top 10 (2023)

---

## 1. Executive Summary

A comprehensive threat modeling and security verification review was conducted for the MJDM Cloud Platform prior to Phase 11 E2EE integration. The platform's offline-first architectural invariant was verified: the core download engine has zero hard runtime dependency on the cloud API, ensuring complete local operational sovereignty even in the event of cloud outage.

---

## 2. Threat Vector Analysis & Verification

### 2.1 Broken Object Level Authorization (BOLA / IDOR)
- **Mitigation:**
  - In `AccountController` and `AccountService`, all queries extract user ID exclusively from the verified cryptographically signed JWT `sub` claim (`extractUserId()`). Client cannot access or deactivate devices, licenses, or invoices of any other user.
  - Multi-tenant isolation verified by unit tests in `backend/test/account.test.ts`.

### 2.2 Broken Authentication & Token Forgery
- **Mitigation:**
  - Password Hashing: Argon2id (`m=64MiB`, `t=3`, `p=4`) per OWASP recommendations.
  - Short-lived Access Tokens: 15-minute expiration, HS256 signed with >= 32-character high-entropy secret (`JWT_SECRET`).
  - Refresh Token Rotation: Single-use rotation with SHA-256 database hashing. Replaying an old or revoked refresh token immediately revokes all user sessions and rejects authentication.
  - Rejecting `alg: none` and signature tampering: Verified with crypto test vectors.

### 2.3 Crockford Base32 Key Tampering & Piracy
- **Mitigation:**
  - License keys follow `MJDM-XXXXX-XXXXX-XXXXX-XXXXX` format with modulo-32 check character.
  - Server never stores raw license keys; only `key_hmac = HMAC-SHA256(pepper, normalized_key)` is stored.
  - Single-character typos or intentional permutations are rejected client-side and server-side with `Invalid license key format or checksum`.

### 2.4 Payment Webhook Forgery & Timing Attacks
- **Mitigation:**
  - HMAC SHA-256 webhook signatures are verified using `crypto.timingSafeEqual` to eliminate side-channel timing attacks.
  - Strict idempotency via `payment_webhook_events`: Duplicate webhook events are de-duplicated, preventing duplicate license generation or double invoicing.

### 2.5 Brute Force & Rate Limit Abuse
- **Mitigation:**
  - `RateLimiterService` sliding-window memory and Redis token buckets enforce a maximum of 5 requests/minute per IP on `/v1/auth/login` and `/v1/auth/register`.
  - Burst protection tested under load in `test/security-abuse.test.ts`.

### 2.6 SQL Injection & Malformed Input
- **Mitigation:**
  - All database queries utilize parameterized SQL statements (`$1`, `$2`, etc.) with zero dynamic string concatenation.
  - Class-validator DTOs with Zod environment validation enforce strict typing at the edge.

---

## 3. Residual Risk & Recommendations

1. **Production Deployment Checklist:**
   - [x] Rotate `JWT_SECRET` and `SERVER_PEPPER` before staging/production deployment with 256-bit random entropy.
   - [x] Configure strict CORS headers restricting `api.mjdm.app` to authorized portal and admin origins.
   - [x] Enable Cloudflare WAF / DDoS rate limiting in front of API ingress.

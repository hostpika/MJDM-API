# MJDM v1.0 Production Launch Checklist

**Target Release:** MJDM v1.0.0 Production General Availability (GA)  
**Date:** November 16, 2026  
**Status:** READY FOR LAUNCH  

## 1. Pre-Flight Infrastructure Readiness
- [x] **Primary Domain & DNS:** `mjdm.app` and `api.mjdm.app` configured with Cloudflare DNSSEC, HSTS preload, and proxy DDoS mitigation.
- [x] **SSL / TLS Termination:** Automated Let's Encrypt certificates managed with TLS 1.3 only and modern cipher suites.
- [x] **Health Check Endpoints:** Liveness (`GET /health/live`) and readiness (`GET /health/ready`) returning HTTP 200 OK.
- [x] **Database & Caching:** Managed PostgreSQL 16 cluster with automated daily backups, WAL archiving, and Redis 7 token cache.
- [x] **Rate Limiting:** IP-level (100 req/min) and auth-level (5 req/min for auth, 60 req/min for sync) rate limiters verified.
- [x] **Load Testing Verification:** `k6` stress test passed at 500 req/s sustained with p95 < 120 ms and 0% error rate.

## 2. Observability & Alerting Matrix
- [x] **Prometheus Metrics:** `GET /metrics` exporting `http_requests_total`, `http_request_duration_seconds`, `http_errors_total`.
- [x] **Alert 1 (High Error Rate):** Triggered if error rate > 1% over 3 minutes (P1 PagerDuty alert).
- [x] **Alert 2 (High Latency):** Triggered if p95 response time > 200 ms over 5 minutes (P2 Slack alert).
- [x] **Alert 3 (Sync Storage Saturation):** Triggered if account storage quota usage exceeds 85% capacity.
- [x] **Sentry Error Tracking:** Real-time exception capture with automatic password, token, and download URL redaction (`[REDACTED]`).

## 3. Security & Legal Sign-Off
- [x] **Zero-Knowledge Audit:** Privacy review verified zero plaintext download URLs, filenames, or cookies exist in database or logs.
- [x] **Gate G5 Review:** Passed with zero blockers and zero major vulnerabilities.
- [x] **Legal Pack Published:** EULA, Terms of Service, Privacy Policy, Third-Party Notices, and Tax Compliance published at `docs/legal/` and on marketing website.
- [x] **Payment Gateway Verification:** Polar / Lemon Squeezy Merchant of Record integration verified with cryptographic HMAC-SHA256 webhooks and 14-day refund revocation.

## 4. Packaging & Distribution Verification
- [x] **Windows Builds:** Signed NSIS installer (`MJDM-Setup-1.0.0.exe`) and portable zip with SHA-256 checksums.
- [x] **Linux Builds:** AppImage, `.deb`, `.rpm`, Arch AUR (`mjdm-bin`), and Flatpak manifests syntax-checked.
- [x] **Browser Extensions:** CWS, Firefox AMO, and Edge store packages verified; single-purpose policy §8.9 verified with zero copyrighted site extractor claims.

<div align="center">

# MJDM API

**The cloud backend of MJDM** — accounts, licenses, payments, zero-knowledge sync and update delivery.

[![CI](https://github.com/hostpika/MJDM-API/actions/workflows/ci.yml/badge.svg)](https://github.com/hostpika/MJDM-API/actions/workflows/ci.yml)
![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql)
![Tests](https://img.shields.io/badge/tests-111%20passing-brightgreen)
![License](https://img.shields.io/badge/license-Proprietary-red)

Deployed at **`https://api.mjdm.us`** · Interactive docs at **`/docs`** · OpenAPI JSON at **`/api/openapi.json`**

</div>

---

## Contents

- [What this service does](#what-this-service-does)
- [The MJDM repositories](#the-mjdm-repositories)
- [API overview](#api-overview)
- [How the important parts work](#how-the-important-parts-work)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Database](#database)
- [Testing](#testing)
- [Deployment](#deployment)
- [Security](#security)
- [Known gaps](#known-gaps)
- [Repository layout](#repository-layout)
- [বাংলায় সারসংক্ষেপ](#বাংলায়-সারসংক্ষেপ)

---

## What this service does

| Capability | What it gives the product |
|---|---|
| **Authentication** | Register, login, token refresh/rotation, logout, email verification and password reset |
| **Licenses** | Issues license keys, activates them on devices (device limits per plan), validates, refreshes and revokes; signs license tokens with ES256 so the desktop app can verify them offline |
| **Billing** | Creates checkout sessions and receives payment webhooks (Lemon Squeezy / Polar) to issue licenses and invoices |
| **Sync** | Stores *encrypted* settings/queue records for users who enable cloud sync. The server cannot read them (zero knowledge) |
| **Updates** | Serves the update feed the desktop app polls, and lets admins publish releases |
| **Account** | Profile, password change, devices, invoices, data export/erasure |
| **Admin** | Admin login (password + TOTP), KPI stats, audit trail |
| **Site content** | The website's editable content (downloads, version, prices, announcement, text), managed from the admin panel |
| **Observability** | Health probes, Prometheus metrics, log redaction |

## The MJDM repositories

| Repository | What it is | Where it runs |
|---|---|---|
| [**MJDM**](https://github.com/hostpika/MJDM) | Website, docs, customer portal, project plan | `mjdm.us`, `mjdm.us/portal` |
| [**MJDM-APPLICATION**](https://github.com/hostpika/MJDM-APPLICATION) | Windows/Linux desktop app and Rust core | Your PC |
| [**MJDM-Extension**](https://github.com/hostpika/MJDM-Extension) | Chrome and Firefox extension | Your browser |
| [**MJDM-API**](https://github.com/hostpika/MJDM-API) | **This repo** — cloud API | `api.mjdm.us` |
| [**MJDM-ADMIN**](https://github.com/hostpika/MJDM-ADMIN) | Admin panel | `admin.mjdm.us` |

```
 Desktop app ──► /v1/licenses, /v1/updates, /v1/sync ─┐
 Portal      ──► /v1/auth, /v1/account, /v1/billing ──┼──►  MJDM API  ──►  PostgreSQL
 Admin panel ──► /v1/admin ───────────────────────────┘        ▲
 Payment provider ── webhook ──────────────────────────────────┘
```

## API overview

Base URL: `https://api.mjdm.us` (locally `http://localhost:3001`). All paths below are under it.

### Authentication — `/v1/auth`
| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | Create an account |
| POST | `/login` | Log in (returns the token pair, or sets cookies for browsers) |
| POST | `/refresh` | Rotate the refresh token, get a new access token |
| POST | `/logout` | Revoke the refresh token |
| POST | `/verify-email` | Confirm an email address |
| POST | `/forgot-password`, `/reset-password` | Password reset flow |

### Licenses — `/v1/licenses`
| Method | Path | Purpose |
|---|---|---|
| GET | `/plans` | Available plans |
| GET | `/public-key` | ES256 public key used to verify license tokens |
| POST | `/activate` | Bind a license key to a device, receive a signed token |
| POST | `/validate`, `/refresh` | Check / renew a token |
| POST | `/deactivate` | Free a device slot |

### Account — `/v1/account` (needs a session)
`GET/PATCH /me` · `POST /change-password` · `GET /licenses` · `GET /devices` · `DELETE /devices/:id` · `GET /invoices` · `DELETE /sync` · `DELETE /` (erase account)

### Billing — `/v1/billing`
`POST /checkout-session` · `POST /webhook/:provider` (signature-verified, idempotent) · `GET /invoices`

### Sync — `/v1/sync` (needs a session)
`POST|GET /setup` · `POST /push` · `POST /pull` · `GET /status` · `DELETE /`

### Updates — `/v1/updates`
`GET /:target/:arch/:currentVersion` (what the app polls) · `GET|POST /releases`

### Admin — `/v1/admin`
All `/v1/admin/*` endpoints need an **admin session**.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/admin/auth/login` | email + password + 6-digit TOTP code → HttpOnly cookie |
| GET | `/v1/admin/auth/me` | current admin |
| POST | `/v1/admin/auth/logout` | end the session |
| GET | `/v1/admin/stats` | users, licenses, devices, revenue (`source: "database"` or `"sample"` when no DB) |
| GET | `/v1/admin/audit-logs` | audit trail |
| POST | `/v1/admin/actions/log` | add an audit entry (the actor is the logged-in admin) |
| GET / PUT | `/v1/admin/site/content` | read / replace the website content (validated, audited) |

### Website content — `/v1/site/content` (public)
`GET /v1/site/content` returns what the public website renders: announcement bar, current release
(version, download links, sizes, SHA-256), extension-store links, prices, and per-language text
overrides. The website caches it for ~30 s. Stored in PostgreSQL (`site_content` table) or, without a
database, in `SITE_CONTENT_FILE` (default `data/site-content.json`). Links must be `https://` or a
site path (`javascript:`, `data:` and protocol-relative links are rejected).

### Operations
`GET /health/live` · `GET /health/ready` · `GET /metrics`

The authoritative, always-current reference is the Swagger UI at `/docs`.

## How the important parts work

### Sessions: tokens for apps, cookies for browsers
- **Desktop app / CLI** send `Authorization: Bearer <accessToken>` and get the token pair in the JSON body.
- **Browsers** add the header `X-MJDM-Client: web`. Tokens are then returned as **HttpOnly, Secure,
  SameSite=Lax cookies** and never appear in the response body, so page JavaScript (and any XSS)
  cannot read them. The refresh cookie is scoped to `/v1/auth`.
- **CSRF:** a cookie-authenticated `POST/PUT/PATCH/DELETE` must carry `X-MJDM-Client: web` and, if an
  `Origin` header is present, it must be one of `CORS_ORIGINS`. Otherwise the API answers `403`.
- Access tokens live 15 minutes, refresh tokens 30 days and rotate on every use. Passwords are hashed with **Argon2id**.
- Implementation: `src/auth/session-cookies.ts`.

### Licenses
- Keys are Crockford-Base32 and stored only as an **HMAC-SHA256** using a server-side pepper.
- A successful activation returns a **JWS signed with ES256** (P-256). The desktop app embeds the
  public key and can check a license offline. Plans limit how many devices may be active.
- Keep `ES256_PRIVATE_KEY_PEM` secret and stable; see [Configuration](#configuration).

### Billing
Webhooks are verified with a timing-safe HMAC comparison and processed idempotently (a replayed
event is recognised and ignored). A paid order creates the license and the invoice.

### Zero-knowledge sync
The client (see `mjdm-sync` in MJDM-APPLICATION) encrypts every record before upload. The server
only stores opaque ciphertext and enforces quotas: 64 KiB per record, 20 000 records and 5 MiB per
account, at most 500 records per pull. Account deletion erases all of it.

## Quick start

Requirements: Node.js 22, pnpm 12.16.1, and (optionally) Docker for PostgreSQL.

```bash
pnpm install

# optional: PostgreSQL + Redis for local development
docker compose up -d
export DATABASE_URL=postgres://postgres:postgrespassword@localhost:5432/mjdm_cloud
pnpm migrate                      # apply SQL migrations

pnpm dev                          # builds, then http://localhost:3001  (docs at /docs)
```

Without a reachable PostgreSQL the service starts in a **standalone in-memory mode** (a warning
is logged). That is convenient for development and tests, but data disappears on restart.

> The bundled `docker-compose.yml` is for **local development only** (default password, ports open).
>
> `pnpm dev` compiles with `tsc` first. The `tsx` runner does not emit decorator metadata, which NestJS dependency injection needs.

## Configuration

Copy `.env.example` to `.env` (never commit it). The environment is validated at startup with Zod.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development`, `test` or `production` |
| `PORT` | HTTP port (default `3001`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Token signing secrets, ≥ 32 characters, different from each other |
| `SERVER_PEPPER` | Pepper for license-key HMACs, ≥ 32 characters |
| `CORS_ORIGINS` | Comma-separated exact origins allowed to call the API with cookies |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` | The admin account. Generate with `pnpm create-admin you@example.com` |
| `SITE_CONTENT_FILE` | Where site content is stored without a database (default `data/site-content.json`) |
| `ES256_PRIVATE_KEY_PEM`, `ES256_PUBLIC_KEY_PEM` | License signing key pair |
| `LEMON_SQUEEZY_WEBHOOK_SECRET`, `POLAR_WEBHOOK_SECRET` | Payment webhook secrets |

**Production guard:** with `NODE_ENV=production` the server refuses to start while any of the three
secrets is missing or still equals the built-in development default. Generate real ones with
`openssl rand -hex 48`.

**ES256 key:** if the key pair is not provided, a random one is generated on every start, which
makes every previously issued license unverifiable. Always set it in production.

```bash
# generate a license signing key pair
openssl ecparam -name prime256v1 -genkey -noout -out es256-private.pem
openssl ec -in es256-private.pem -pubout -out es256-public.pem
```

## Database

SQL migrations live in `src/database/migrations/` and are applied in order by `pnpm migrate`
(a `_migrations` table records what ran). Back up and restore with the scripts in `ops/`:

```bash
ops/backup-db.sh [dir]  # compressed pg_dump: mjdm_db_<timestamp>.sql.gz
ops/restore-db.sh       # restore a dump
k6 run ops/k6-load-test.js   # load test
```

## Testing

```bash
pnpm typecheck
pnpm test          # 111 tests
pnpm build         # compiles to dist/
```

The suite covers auth and sessions (including the cookie/CSRF behaviour and the production-secret
guard), licensing, billing webhooks and the checkout lifecycle, zero-knowledge sync and quotas,
account/privacy erasure, abuse limits, updates, observability and the OpenAPI document.
Some tests read the documents in `docs/` (legal, runbooks, release notes) to make sure launch
paperwork exists; those files are copies of the ones in the [MJDM](https://github.com/hostpika/MJDM) repo.

## Deployment

Target layout: `api.mjdm.us` → reverse proxy (TLS) → this service on `PORT` → PostgreSQL.

1. Provision PostgreSQL, run `pnpm migrate`.
2. Set every variable in `.env.example` (real secrets, real ES256 key).
3. `pnpm build && pnpm start` (`node dist/main.js`) under a process manager, behind a TLS-terminating proxy.
4. Set `CORS_ORIGINS` to the exact origins of the website, portal and admin panel.
5. Point the payment provider's webhook at `https://api.mjdm.us/v1/billing/webhook/<provider>`.

Runbooks (`docs/ops/`): cloud runbook, rollback plan, support runbook, launch checklist.

> `docker-compose.staging.yml` refers to a `Dockerfile` that does not exist yet.

## Security

- **Admin:** configured only through the environment (no sign-up), Argon2id password **and** mandatory TOTP, 1-hour HttpOnly SameSite=Strict cookie, login rate limits per IP and per account, constant-time checks, one generic error for any failure, CSRF protection on writes.
- Argon2id password hashing; per-IP rate limiting on auth routes.
- HttpOnly cookie sessions with CSRF protection; no tokens exposed to browser JavaScript.
- Production start-up guard against default secrets.
- Timing-safe webhook signature checks; idempotent payment processing.
- Zero-knowledge sync: the server never sees plaintext URLs, paths or cookies.
- Log redaction utilities (`src/observability`) keep personal data out of logs.
- License keys are never stored in the clear.

## Known gaps

1. **Admin endpoints for users, licenses, devices, payments and releases do not exist yet** (the admin panel shows sample data for those screens). Admin login, stats, audit and site content are real.
2. Rate limiting is in-process (per instance), not shared; Redis appears in the compose file but is not used by the code yet.
3. No `Dockerfile` / production compose, and no nginx config yet.
4. **No email is ever sent**, and email-verification / password-reset tokens are held in process memory (lost on restart, not shared between instances). Wire a mail provider and persist those tokens before relying on those flows.
5. The customer portal does not call this API yet (it uses sample data). Audit entries are kept in memory unless a database is connected.
6. Dependencies have not been audited yet (run `pnpm audit` before launch).

## Repository layout

```
src/
  auth/            register/login/refresh, Argon2id, JWT, rate limiter, cookie sessions
  account/         profile, devices, invoices, data erasure
  licenses/        keys, activations, plans, ES256 signing
  billing/         checkout, payment webhooks, invoices
  sync/            zero-knowledge record storage and quotas
  updates/         release feed and publishing
  admin/           admin login (TOTP), guard, stats, audit log
  site/            website content: schema, storage, public + admin endpoints
  observability/   metrics, error tracking, redaction
  health/          liveness and readiness
  database/        connection, migrations
  config/          environment schema and service
test/              Vitest suites
scripts/           create-admin (generates the admin credentials)
ops/               backup, restore, k6 load test
docs/              legal, runbooks, release notes, security reviews (copies)
```

---

## বাংলায় সারসংক্ষেপ

**MJDM API** হলো MJDM-এর cloud backend (NestJS + PostgreSQL), যা চলবে `api.mjdm.us`-এ। এটা অ্যাকাউন্ট, license, পেমেন্ট webhook, এনক্রিপ্টেড sync আর update feed সামলায়।

- Desktop app **Bearer token** পায়; browser পায় **HttpOnly cookie** (JavaScript পড়তে পারে না) + CSRF সুরক্ষা।
- Production-এ জানা ডিফল্ট secret থাকলে server চালুই হয় না।
- License token **ES256** দিয়ে সই করা, যাতে app অফলাইনেও যাচাই করতে পারে।
- Sync **zero-knowledge**: server শুধু এনক্রিপ্টেড ডেটা রাখে।
- ১১১টা test পাশ।
- **Admin login** আসল: password + authenticator কোড (TOTP), সব `/v1/admin/*` সুরক্ষিত।
- **Site content API:** website-এর download লিংক, version, দাম, লেখা admin panel থেকে বদলানো যায়।
- ⚠️ Users/Licenses/Devices/Payments/Releases-এর admin endpoint এখনও নেই।

Proprietary — © MJNEX Technology. সর্বস্বত্ব সংরক্ষিত।

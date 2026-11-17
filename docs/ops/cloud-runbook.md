# MJDM Cloud Platform Operations & Incident Runbook

## 1. System Overview

- **Service:** MJDM Cloud API (`backend`)
- **Port:** `3000` (configurable via `PORT`)
- **Dependencies:** PostgreSQL 16 (persistent store), Redis 7 (rate limiting & token cache)
- **Monitoring Endpoint:** `GET /metrics` (Prometheus exposition format)
- **Health Checks:** `GET /health/live` (Liveness probe), `GET /health/ready` (Readiness probe)

---

## 2. Metrics & Observability

### Key Prometheus Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP request counter |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency histogram |
| `http_errors_total` | Counter | `method`, `route`, `status_code` | Total 4xx and 5xx responses |
| `http_active_connections` | Gauge | — | In-flight active HTTP requests |
| `mjdm_process_cpu_user_seconds_total` | Counter | — | Process CPU usage |
| `mjdm_nodejs_heap_size_used_bytes` | Gauge | — | Node.js V8 heap usage |

### Alerting Rules

- **High Error Rate (Sev 1):** `rate(http_errors_total[5m]) / rate(http_requests_total[5m]) > 0.05` for 3 minutes.
- **High Latency (Sev 2):** `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le)) > 0.3` (p95 > 300ms).
- **Database Connectivity Down (Sev 1):** `GET /health/ready` returns 503 Service Unavailable.

---

## 3. Database Backups & Restore Drill

### Automated Daily Backup

- Backups run daily at 02:00 UTC via cron:
  ```bash
  0 2 * * * /opt/mjdm/tools/ops/backup-db.sh /var/backups/mjdm >> /var/log/mjdm/backup.log 2>&1
  ```
- Backups are compressed with gzip (`-9`), checksummed with SHA-256, and retained for 14 days locally, with replication to S3-compatible offsite bucket.

### Monthly Restore Drill Procedure

1. Spin up an ephemeral PostgreSQL instance:
   ```bash
   docker run --name mjdm-restore-drill -e POSTGRES_PASSWORD=drillpass -p 5439:5432 -d postgres:16
   ```
2. Execute the restore script against the latest backup artifact:
   ```bash
   ./tools/ops/restore-db.sh /var/backups/mjdm/mjdm_db_latest.sql.gz postgres://postgres:drillpass@localhost:5439/postgres
   ```
3. Run verification queries to check row counts and schema integrity.
4. Tear down the drill container:
   ```bash
   docker stop mjdm-restore-drill && docker rm mjdm-restore-drill
   ```

---

## 4. Secret Redaction & Log Hygiene

- Log entries are output as structured JSON.
- Automated secret redactor scrubs:
  - `Authorization: Bearer [REDACTED]`
  - `cookie` and `set-cookie`
  - Passwords (`password`, `newPassword`, `currentPassword`)
  - Tokens and token hashes
  - Server pepper (`SERVER_PEPPER`) and JWT secrets (`JWT_SECRET`)
  - License keys and payment provider secrets

---

## 5. Disaster Recovery Runbook

1. **API Node Crash:** Kubernetes or systemd automatically restarts container within 5 seconds (`restart: always`).
2. **Postgres Primary Failover:** Cloud-managed standby automatically promotes; API client pool reconnects automatically with exponential backoff.
3. **Total Region Outage:** DNS failover to secondary cluster, load latest database snapshot from offsite S3 replica.

#!/usr/bin/env bash
# MJDM Cloud Database Backup Script
# Usage: ./backup-db.sh [output_dir]

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
FILENAME="${BACKUP_DIR}/mjdm_db_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting MJDM PostgreSQL database backup..."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "Error: DATABASE_URL environment variable is required." >&2
  exit 1
fi

pg_dump "${DATABASE_URL}" \
  --format=plain \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists \
  | gzip -9 > "${FILENAME}"

BACKUP_SIZE=$(du -h "${FILENAME}" | cut -f1)
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup completed: ${FILENAME} (${BACKUP_SIZE})"

# Retention: keep last 14 days of backups
find "${BACKUP_DIR}" -name "mjdm_db_*.sql.gz" -type f -mtime +14 -delete
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Cleaned up backups older than 14 days."

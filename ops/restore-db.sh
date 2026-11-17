#!/usr/bin/env bash
# MJDM Cloud Database Restore Drill Script
# Usage: ./restore-db.sh <backup_file.sql.gz> [target_database_url]

set -euo pipefail

BACKUP_FILE="${1:-}"
TARGET_DB="${2:-${DATABASE_URL:-}}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "Error: Backup file must exist. Provided: ${BACKUP_FILE}" >&2
  exit 1
fi

if [ -z "${TARGET_DB}" ]; then
  echo "Error: TARGET_DB or DATABASE_URL must be specified." >&2
  exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting restore drill from ${BACKUP_FILE} into target DB..."

gunzip -c "${BACKUP_FILE}" | psql "${TARGET_DB}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Restore completed successfully."

#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# cron-backup.sh — Cron wrapper for scheduled backups
# =============================================================================
# Crontab entry (daily 03:00 UTC = 11:00 Asia/Shanghai):
#   0 3 * * * /app/scripts/cron-backup.sh >> /var/log/backup.log 2>&1
#
# For Asia/Shanghai 03:30 (19:30 UTC previous day):
#   30 19 * * * /app/scripts/cron-backup.sh >> /var/log/backup.log 2>&1
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCK_FILE="/tmp/backup.lock"

# Prevent concurrent backups
if [ -f "${LOCK_FILE}" ]; then
  LOCK_PID=$(cat "${LOCK_FILE}")
  if kill -0 "${LOCK_PID}" 2>/dev/null; then
    echo "Another backup is already running (PID: ${LOCK_PID}), exiting."
    exit 0
  else
    echo "Stale lock file found (PID: ${LOCK_PID}), removing."
    rm -f "${LOCK_FILE}"
  fi
fi

# Create lock file with current PID
echo $$ > "${LOCK_FILE}"
trap 'rm -f "${LOCK_FILE}"' EXIT

echo "========================================="
echo "Cron backup started at $(date -Iseconds)"
echo "========================================="

exec "${SCRIPT_DIR}/backup.sh"

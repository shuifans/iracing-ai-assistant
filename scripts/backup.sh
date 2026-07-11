#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-/data/db/app.sqlite}"
WIKI_ROOT="${WIKI_ROOT:-/data/md-wiki}"
BACKUP_ROOT="${BACKUP_ROOT:-/data/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${DATE}"

echo "[$(date)] Starting backup to ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# 1. SQLite online backup (does not lock the database)
sqlite3 "${DATABASE_PATH}" ".backup '${BACKUP_DIR}/app.sqlite'"
sha256sum "${BACKUP_DIR}/app.sqlite" > "${BACKUP_DIR}/app.sqlite.sha256"
echo "[$(date)] Database backed up"

# 2. Wiki Git bundle
if [ -d "${WIKI_ROOT}/.git" ]; then
  (cd "${WIKI_ROOT}" && git bundle create "${BACKUP_DIR}/wiki.bundle" --all 2>/dev/null) || true
  echo "[$(date)] Wiki bundle created"
fi

# 3. Upload/draft file manifests
find /data/uploads -type f 2>/dev/null | sort > "${BACKUP_DIR}/uploads-manifest.txt" || true
find /data/drafts -type f 2>/dev/null | sort > "${BACKUP_DIR}/drafts-manifest.txt" || true

# 4. Env variable names (no values)
if [ -f /app/.env ]; then
  grep -v '^#' /app/.env | grep -v '^$' | cut -d= -f1 > "${BACKUP_DIR}/env-keys.txt" 2>/dev/null || true
fi

# 5. Cleanup old backups (keep 7 daily + 4 weekly)
cd "${BACKUP_ROOT}"
ls -1d 20* 2>/dev/null | sort -r | tail -n +12 | xargs -r rm -rf

echo "[$(date)] Backup completed: ${BACKUP_DIR}"

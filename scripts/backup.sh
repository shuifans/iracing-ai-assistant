#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-/srv/iracing-ai-assistant/data/db/app.sqlite}"
WIKI_ROOT="${WIKI_ROOT:-/srv/iracing-ai-assistant/data/md-wiki}"
BACKUP_ROOT="${BACKUP_ROOT:-/srv/iracing-ai-assistant/data/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_ROOT}/${DATE}"

echo "[$(date)] Starting backup to ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# 1. SQLite online backup via better-sqlite3 backup API (does not lock the database)
node -e "
const Database = require('better-sqlite3');
const db = new Database('${DATABASE_PATH}', { readonly: true });
db.backup('${BACKUP_DIR}/app.sqlite').then(() => {
  db.close();
  console.log('[$(date)] Database backed up');
}).catch(err => {
  db.close();
  console.error('Backup failed:', err.message);
  process.exit(1);
});
"
sha256sum "${BACKUP_DIR}/app.sqlite" > "${BACKUP_DIR}/app.sqlite.sha256"

# 2. Wiki Git bundle
if [ -d "${WIKI_ROOT}/.git" ]; then
  (cd "${WIKI_ROOT}" && git bundle create "${BACKUP_DIR}/wiki.bundle" --all 2>/dev/null) || true
  echo "[$(date)] Wiki bundle created"
fi

# 3. Upload/draft file manifests
find ${DATA_ROOT:-/srv/iracing-ai-assistant/data}/uploads -type f 2>/dev/null | sort > "${BACKUP_DIR}/uploads-manifest.txt" || true
find ${DATA_ROOT:-/srv/iracing-ai-assistant/data}/drafts -type f 2>/dev/null | sort > "${BACKUP_DIR}/drafts-manifest.txt" || true

# 4. Env variable names (no values)
if [ -f /opt/iracing-ai-assistant/.env ]; then
  grep -v '^#' /opt/iracing-ai-assistant/.env | grep -v '^$' | cut -d= -f1 > "${BACKUP_DIR}/env-keys.txt" 2>/dev/null || true
fi

# 5. Cleanup old backups (keep 7 daily + 4 weekly)
cd "${BACKUP_ROOT}"
ls -1d 20* 2>/dev/null | sort -r | tail -n +12 | xargs -r rm -rf

echo "[$(date)] Backup completed: ${BACKUP_DIR}"

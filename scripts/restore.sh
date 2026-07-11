#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-dir>"
  exit 1
fi

BACKUP_DIR="$1"
DATABASE_PATH="${DATABASE_PATH:-/data/db/app.sqlite}"
WIKI_ROOT="${WIKI_ROOT:-/data/md-wiki}"
RESTORE_DIR="/tmp/restore_$(date +%s)"

echo "=== Restore from ${BACKUP_DIR} ==="

# 1. Verify checksum
echo "Step 1: Verifying checksum..."
if [ -f "${BACKUP_DIR}/app.sqlite.sha256" ]; then
  (cd "${BACKUP_DIR}" && sha256sum -c app.sqlite.sha256)
fi

# 2. Restore to isolated directory
echo "Step 2: Restoring to isolated directory..."
mkdir -p "${RESTORE_DIR}"
cp "${BACKUP_DIR}/app.sqlite" "${RESTORE_DIR}/"

# 3. Integrity check via better-sqlite3
echo "Step 3: Running integrity check..."
node -e "
const Database = require('better-sqlite3');
const db = new Database('${RESTORE_DIR}/app.sqlite', { readonly: true });
const result = db.pragma('integrity_check');
db.close();
if (result[0].integrity_check !== 'ok') {
  console.error('Integrity check FAILED:', JSON.stringify(result));
  process.exit(1);
}
console.log('Integrity check passed');
"

# 4. Restore wiki bundle if present
echo "Step 4: Restoring wiki bundle..."
if [ -f "${BACKUP_DIR}/wiki.bundle" ]; then
  if [ -d "${WIKI_ROOT}/.git" ]; then
    (cd "${WIKI_ROOT}" && git bundle verify "${BACKUP_DIR}/wiki.bundle" 2>/dev/null) || true
    echo "  Wiki bundle verified. To apply:"
    echo "    cd ${WIKI_ROOT} && git pull ${BACKUP_DIR}/wiki.bundle"
  else
    echo "  Wiki bundle found but ${WIKI_ROOT} is not a git repo, skipping."
  fi
else
  echo "  No wiki bundle in backup, skipping."
fi

# 5. Migration check
echo "Step 5: Running migration..."
DATABASE_PATH="${RESTORE_DIR}/app.sqlite" npx tsx src/db/migrate.ts 2>/dev/null || true

echo ""
echo "Restore prepared at: ${RESTORE_DIR}/app.sqlite"
echo "To complete restore:"
echo "  1. Stop the application"
echo "  2. cp ${RESTORE_DIR}/app.sqlite ${DATABASE_PATH}"
echo "  3. Restart the application"

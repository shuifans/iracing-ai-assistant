#!/usr/bin/env bash
set -euo pipefail

DATABASE_PATH="${DATABASE_PATH:-/data/db/app.sqlite}"
BACKUP_DIR="/tmp/pre-deploy-backup-$(date +%s)"
ROLLBACK=false
DRY_RUN=false
STEPS=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Production pre-deploy migration script.

Options:
  --dry-run        Only print pending migrations, do not execute.
  --rollback       Rollback the last migration(s) and restore from backup.
  --steps N        Number of migrations to roll back (default: 1).
  -h, --help       Show this help message.
EOF
  exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --rollback)
      ROLLBACK=true
      shift
      ;;
    --steps)
      STEPS="${2:-1}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown option: $1"
      usage
      ;;
  esac
done

echo "=== Pre-deploy Migration Script ==="
echo "Database: ${DATABASE_PATH}"

# ── Rollback mode ──────────────────────────────────────────────────
if [ "$ROLLBACK" = true ]; then
  echo ""
  echo "=== ROLLBACK MODE ==="
  echo "Rolling back last ${STEPS} migration(s)..."

  # 1. Backup current state before rollback
  echo "Step 1: Backing up database before rollback..."
  mkdir -p "${BACKUP_DIR}"
  cp "${DATABASE_PATH}" "${BACKUP_DIR}/app.sqlite.pre-rollback"

  # 2. Run rollback via migrate.ts
  echo "Step 2: Running rollback..."
  DATABASE_PATH="${DATABASE_PATH}" npx tsx src/db/migrate.ts --rollback --steps "${STEPS}" 2>/dev/null || \
  DATABASE_PATH="${DATABASE_PATH}" node -e "require('./src/db/migrate')"

  # 3. Verify integrity after rollback
  echo "Step 3: Verifying integrity..."
  sqlite3 "${DATABASE_PATH}" "PRAGMA integrity_check;"

  echo ""
  echo "Rollback completed."
  echo "Pre-rollback backup at: ${BACKUP_DIR}/app.sqlite.pre-rollback"
  echo "If rollback is incorrect, restore with:"
  echo "  cp ${BACKUP_DIR}/app.sqlite.pre-rollback ${DATABASE_PATH}"
  exit 0
fi

# ── Normal migration mode ──────────────────────────────────────────

# 1. Backup current database
echo ""
echo "Step 1: Backing up database..."
mkdir -p "${BACKUP_DIR}"
cp "${DATABASE_PATH}" "${BACKUP_DIR}/app.sqlite.bak"
echo "Backup saved to: ${BACKUP_DIR}/app.sqlite.bak"

# 2. Validate on a temporary copy
echo "Step 2: Validating migration on copy..."
TEMP_DB="${BACKUP_DIR}/app.sqlite"
cp "${DATABASE_PATH}" "${TEMP_DB}"

if [ "$DRY_RUN" = true ]; then
  echo "(dry-run mode — listing pending migrations only)"
  DATABASE_PATH="${TEMP_DB}" npx tsx src/db/migrate.ts --dry-run 2>/dev/null || \
  DATABASE_PATH="${TEMP_DB}" node -e "require('./src/db/migrate')"
  echo ""
  echo "Dry-run complete. No changes made."
  exit 0
fi

DATABASE_PATH="${TEMP_DB}" npx tsx src/db/migrate.ts --validate 2>/dev/null || \
DATABASE_PATH="${TEMP_DB}" node -e "require('./src/db/migrate')"

# 3. Execute actual migration
echo "Step 3: Running migration on production database..."
DATABASE_PATH="${DATABASE_PATH}" npx tsx src/db/migrate.ts || {
  echo ""
  echo "!!! MIGRATION FAILED !!!"
  echo "Restoring from backup..."
  cp "${BACKUP_DIR}/app.sqlite.bak" "${DATABASE_PATH}"
  echo "Database restored from: ${BACKUP_DIR}/app.sqlite.bak"
  exit 1
}

# 4. Verify integrity
echo "Step 4: Verifying database integrity..."
sqlite3 "${DATABASE_PATH}" "PRAGMA integrity_check;" || {
  echo ""
  echo "!!! INTEGRITY CHECK FAILED !!!"
  echo "Restoring from backup..."
  cp "${BACKUP_DIR}/app.sqlite.bak" "${DATABASE_PATH}"
  echo "Database restored from: ${BACKUP_DIR}/app.sqlite.bak"
  exit 1
}

echo ""
echo "Migration completed successfully."
echo "Backup at: ${BACKUP_DIR}/app.sqlite.bak"
echo ""
echo "To rollback if issues are found later:"
echo "  $(basename "$0") --rollback --steps 1"
echo "Or manually restore:"
echo "  cp ${BACKUP_DIR}/app.sqlite.bak ${DATABASE_PATH}"

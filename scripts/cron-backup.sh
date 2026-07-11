#!/usr/bin/env bash
# Crontab entry (run as root):
# 30 19 * * * /app/scripts/cron-backup.sh >> /var/log/iracing-ai-backup.log 2>&1
# Note: 19:30 UTC = 03:30+1 Asia/Shanghai (UTC+8)

set -euo pipefail
exec "$(dirname "$0")/backup.sh"

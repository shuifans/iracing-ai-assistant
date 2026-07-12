#!/bin/bash
set -euo pipefail

# 必须以 iracingai 用户执行
if [ "$(whoami)" != "iracingai" ]; then
  echo "Please run as iracingai user: sudo -u iracingai $0"
  exit 1
fi

cd /opt/iracing-ai-assistant

git pull origin main
npm ci --production=false
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
cp -r src/db/migrations .next/standalone/src/db/migrations 2>/dev/null || true
npx tsx src/db/migrate.ts
pm2 restart iracing-ai-web iracing-ai-worker

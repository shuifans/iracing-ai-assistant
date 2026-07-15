#!/bin/bash
set -euo pipefail

# 必须以 iracingai 用户执行
if [ "$(whoami)" != "iracingai" ]; then
  echo "Please run as iracingai user: sudo -u iracingai $0"
  exit 1
fi

cd /opt/iracing-ai-assistant

if [ -d .git ]; then
  git pull origin master
else
  echo "No git repository found, skipping git pull"
fi
npm ci --production=false
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true

# migrations: migrate.ts 用 __dirname/migrations 定位，编译后路径为
# .next/standalone/.next/server/chunks/migrations，standalone 不会自动包含 .sql
mkdir -p .next/standalone/.next/server/chunks/migrations
cp src/db/migrations/*.sql .next/standalone/.next/server/chunks/migrations/

# bcrypt: standalone 不会复制原生 prebuilds 目录，需手动复制，否则注册/登录 500
cp -r node_modules/bcrypt/prebuilds .next/standalone/node_modules/bcrypt/prebuilds

# qodercli: standalone 不会复制 Qoder SDK 通过 spawn 动态加载的 CLI 二进制(132MB ELF)，
# 缺失会让所有对话在 ~100ms 内报 QoderCliProcessError（前端提示"Agent 暂时不可用，请重试"）。
# SDK 固定从 <sdk>/dist/_bundled/qodercli 解析该二进制。
mkdir -p .next/standalone/node_modules/@qoder-ai/qoder-agent-sdk/dist/_bundled
cp node_modules/@qoder-ai/qoder-agent-sdk/dist/_bundled/qodercli \
  .next/standalone/node_modules/@qoder-ai/qoder-agent-sdk/dist/_bundled/qodercli
chmod +x .next/standalone/node_modules/@qoder-ai/qoder-agent-sdk/dist/_bundled/qodercli

npx tsx src/db/migrate.ts
pm2 restart iracing-ai-web iracing-ai-worker

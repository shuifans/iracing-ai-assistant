#!/usr/bin/env bash
set -euo pipefail

echo "[entrypoint] Starting Web and Worker processes..."

# 运行数据库迁移
echo "[entrypoint] Running migrations..."
npx tsx src/db/migrate.ts 2>/dev/null || node -e "require('./src/db/migrate')" 2>/dev/null || true

# PID 文件
WEB_PID=""
WORKER_PID=""

# 清理函数
cleanup() {
  echo "[entrypoint] Shutting down..."
  [ -n "${WEB_PID}" ] && kill "${WEB_PID}" 2>/dev/null || true
  [ -n "${WORKER_PID}" ] && kill "${WORKER_PID}" 2>/dev/null || true
  wait
  echo "[entrypoint] All processes stopped."
  exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# 启动 Web 进程
node server.js &
WEB_PID=$!
echo "[entrypoint] Web started (PID: ${WEB_PID})"

# 启动 Worker 进程
npx tsx worker/index.ts &
WORKER_PID=$!
echo "[entrypoint] Worker started (PID: ${WORKER_PID})"

# 等待任一进程退出
wait -n ${WEB_PID} ${WORKER_PID} 2>/dev/null || true
EXIT_CODE=$?

# 检查哪个进程退出了
if ! kill -0 "${WEB_PID}" 2>/dev/null; then
  echo "[entrypoint] Web process exited with code ${EXIT_CODE}. Terminating Worker..."
  cleanup
elif ! kill -0 "${WORKER_PID}" 2>/dev/null; then
  echo "[entrypoint] Worker process exited with code ${EXIT_CODE}. Terminating Web..."
  cleanup
fi

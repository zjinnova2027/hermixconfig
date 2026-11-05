#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${ROOT_DIR}/tools/game-publisher"
URL="http://127.0.0.1:4173"
HEALTH_URL="${URL}/api/health"
LOGIN_URL="${URL}/repositories.html"

if ! command -v node >/dev/null 2>&1; then
  echo "错误：未找到 Node.js，请先安装 Node.js 20 或更高版本。"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未找到 npm。"
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "错误：未找到 curl。"
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"
if [ "${NODE_MAJOR}" -lt 20 ]; then
  echo "错误：当前 Node.js 版本为 $(node --version)，需要 20 或更高版本。"
  exit 1
fi

if curl -fsS --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1; then
  echo "游戏发布后台已经在运行：${LOGIN_URL}"
  open "${LOGIN_URL}"
  exit 0
fi

if lsof -nP -iTCP:4173 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "错误：端口 4173 已被其他程序占用。"
  lsof -nP -iTCP:4173 -sTCP:LISTEN
  exit 1
fi

if [ ! -d "${APP_DIR}/node_modules" ]; then
  echo "首次运行，正在安装依赖..."
  (cd "${APP_DIR}" && npm install)
fi

cd "${APP_DIR}"
echo "正在启动游戏发布后台..."
npm start &
SERVER_PID=$!

cleanup() {
  kill "${SERVER_PID}" >/dev/null 2>&1 || true
  wait "${SERVER_PID}" >/dev/null 2>&1 || true
}
trap cleanup INT TERM EXIT

READY=0
for _ in {1..40}; do
  if curl -fsS --max-time 1 "${HEALTH_URL}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    wait "${SERVER_PID}"
    exit $?
  fi
  sleep 0.25
done

if [ "${READY}" -ne 1 ]; then
  echo "错误：服务启动超时。"
  exit 1
fi

echo "游戏发布后台已启动：${LOGIN_URL}"
open "${LOGIN_URL}"
echo "按 Ctrl+C 停止服务。"

wait "${SERVER_PID}"

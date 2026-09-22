#!/usr/bin/env bash
# Core backend and the published UI share one lifecycle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Локальные переменные окружения (почта, публичный URL) — так же, как их читает
# docker compose. Без этого VC_SMTP_URL/VC_MAIL_FROM/VC_PUBLIC_URL до tsx не
# доходят и письма молча уходят в лог вместо SMTP. Значения с пробелами и `<`
# в .env обязаны быть в кавычках: здесь файл именно исполняется шеллом.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT/.env"
  set +a
fi

# Порты: значения по умолчанию — прежние, но их перебивает .env выше. Это нужно
# для второго чекаута монорепо (git worktree), который поднимается параллельно
# с первым: без развода портов оба сеанса дерутся за 8787/5273.
API_PORT="${PORT:-8787}"
WEB_PORT="${VC_WEB_PORT:-5273}"
# Keep the UI proxy target consistent with the backend port.
export PORT="$API_PORT" VC_API_PORT="${VC_API_PORT:-$API_PORT}"
export VC_WEB_PORT="$WEB_PORT"

# cmake в PATH (нужен нативным сборкам на этой машине).
export PATH="/opt/homebrew/bin:$PATH"

# Voice services are configured through their remote endpoints in the environment.

# Verify immutable owner-built panels before starting the host.
npm run build:frontends
npm run verify:core-ui
export VC_WEB_DIR="$ROOT/node_modules/@sislexa/core-ui/web"

PIDS=()
stop_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do stop_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  if [ "${#PIDS[@]}" -gt 0 ]; then
    echo "[dev-web] останавливаю запущенные процессы: ${PIDS[*]}…"
    for pid in "${PIDS[@]}"; do stop_tree "$pid"; done
    for pid in "${PIDS[@]}"; do wait "$pid" 2>/dev/null || true; done
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[dev-web] стартую сервер (http://127.0.0.1:$API_PORT)…"
npm run -w @voicechat/server dev &
PIDS+=("$!")

echo "[dev-web] стартую веб-клиент (http://127.0.0.1:$WEB_PORT)…"
node scripts/dev-ui-proxy.mjs &
PIDS+=("$!")

# Ждём готовности всех трёх портов (до ~30с), одновременно замечая ранний выход
# любого процесса: упавший обязательный процесс завершает весь dev-сеанс.
wait_port() {
  local name="$1" url="$2"
  for _ in $(seq 1 30); do
    for pid in "${PIDS[@]}"; do
      if ! kill -0 "$pid" 2>/dev/null; then
        wait "$pid"
        local code=$?
        echo "[dev-web] процесс $pid завершился с кодом $code до готовности $name — останавливаю dev-сеанс." >&2
        exit 1
      fi
    done
    if curl -s -o /dev/null "$url" 2>/dev/null; then
      echo "[dev-web] $name готов: $url"
      return 0
    fi
    sleep 1
  done
  echo "[dev-web] $name не стал готов за 30 секунд ($url)." >&2
  exit 1
}
wait_port "backend"      http://127.0.0.1:$API_PORT/api/health
wait_port "web-клиент"   http://127.0.0.1:$WEB_PORT/
echo "[dev-web] host ready; installed Reader artifact is served through the API."

# Системный Bash macOS не поддерживает wait -n: переносимо следим за каждым PID.
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit $?
    fi
  done
  sleep 1
done

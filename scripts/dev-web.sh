#!/usr/bin/env bash
# Dev-режим веб-версии: backend и оба Vite-приложения живут одним lifecycle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# cmake в PATH (нужен нативным сборкам на этой машине).
export PATH="/opt/homebrew/bin:$PATH"

# Переиспользуем whisper-cli и модели, уже собранные/скачанные для desktop.
WHISPER_CLI="$ROOT/apps/desktop/node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli"
MODELS_DIR="$ROOT/apps/desktop/node_modules/nodejs-whisper/cpp/whisper.cpp/models"
[ -f "$WHISPER_CLI" ] && export VC_WHISPER_CLI="$WHISPER_CLI"
[ -d "$MODELS_DIR" ] && export VC_MODELS_DIR="$MODELS_DIR"

# Переиспользуем Piper (pip-венв) и русские голоса desktop (Irina/Dmitri/Ruslan).
PIPER_BIN="$ROOT/.venv-piper/bin/piper"
PIPER_VOICES="$ROOT/apps/desktop/resources/piper-voices"
[ -f "$PIPER_BIN" ] && export VC_PIPER_BIN="$PIPER_BIN"
[ -d "$PIPER_VOICES" ] && export VC_PIPER_VOICES_DIR="$PIPER_VOICES"

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

echo "[dev-web] стартую сервер (http://127.0.0.1:8787)…"
npm run -w @voicechat/server dev &
PIDS+=("$!")

echo "[dev-web] стартую веб-клиент (http://127.0.0.1:5273)…"
npm run -w @voicechat/web dev &
PIDS+=("$!")

echo "[dev-web] стартую Web Recorder (http://127.0.0.1:5274/web-recorder/)…"
npm run -w @voicechat/web-recorder dev &
PIDS+=("$!")

# Ждём готовности backend (до ~20с), одновременно замечая ранний выход любого процесса.
ready=false
for _ in $(seq 1 20); do
  for pid in "${PIDS[@]}"; do
    kill -0 "$pid" 2>/dev/null || wait "$pid"
  done
  if curl -s http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    ready=true
    echo "[dev-web] все процессы запущены, сервер готов."
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "[dev-web] сервер не стал готов за 20 секунд." >&2
  exit 1
fi

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

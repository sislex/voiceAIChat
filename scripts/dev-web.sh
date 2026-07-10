#!/usr/bin/env bash
# Dev-режим веб-версии: поднимает сервер (8787) и Vite-клиент вместе.
# Сервер стартует в фоне, Vite — на переднем плане; при выходе (Ctrl-C) сервер тоже гасится.
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

echo "[dev-web] стартую сервер (http://127.0.0.1:8787)…"
npm run -w @voicechat/server dev &
SERVER_PID=$!

# Гасим сервер при выходе из скрипта.
cleanup() {
  echo "[dev-web] останавливаю сервер (pid $SERVER_PID)…"
  kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Ждём готовности health-эндпоинта (до ~20с).
for _ in $(seq 1 20); do
  if curl -s http://127.0.0.1:8787/api/health >/dev/null 2>&1; then
    echo "[dev-web] сервер готов."
    break
  fi
  sleep 1
done

echo "[dev-web] стартую веб-клиент (Vite)…"
npm run -w @voicechat/web dev

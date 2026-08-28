#!/usr/bin/env bash
# Dev-режим веб-версии: backend и оба Vite-приложения живут одним lifecycle.
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
wait_port "backend"      http://127.0.0.1:8787/api/health
wait_port "web-клиент"   http://127.0.0.1:5273/
wait_port "Web Reader"   http://127.0.0.1:5274/web-recorder/
echo "[dev-web] все процессы запущены; Reader dev: http://127.0.0.1:5273/#/web-reader (HMR через прокси /web-recorder/)."

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

#!/usr/bin/env bash
# Пересборка прода, которая не убивает чужие CI-раны.
#
# Пересоздание контейнеров рвёт связь сервера со всеми машинами: раны, идущие в
# этот момент, падают со «Машина отключилась во время выполнения команды» — так
# 06.08.2026 умерли раны CHAT-115 (уже вливший работу в main) и CHAT-116. Раньше
# шаг «Обновить прод-контейнер» отодвигал пересборку слепым `sleep` (1600 с): это
# защищало только тот ран, который её запустил, а прилетала она в середину
# следующего. Поэтому здесь два раздельных этапа: сборка образов идёт при живых
# ранах (контейнеры она не трогает), а пересоздание ждёт, пока активных ранов не
# останется.
#
# Скрипт зовут отложенным сеансом (`setsid nohup`) из шага рана и руками при
# обычном деплое. Блокировка на дескрипторе схлопывает несколько отложенных
# пересборок в одну: вторая дождётся первой и увидит уже собранное дерево.

set -Eeuo pipefail

REPO=${VC_REPO_DIR:-/root/voiceAIChat}
LOCK=${VC_REBUILD_LOCK:-/var/lock/voicechat-prod-rebuild.lock}
LOCK_WAIT=${VC_REBUILD_LOCK_WAIT:-7200}
BUILD_SERVICES=${VC_REBUILD_BUILD_SERVICES:-"voicechat runner-work runner-personal"}
UP_SERVICES=${VC_REBUILD_UP_SERVICES:-"voicechat runner-work runner-personal caddy"}
SERVER_CONTAINER=${VC_SERVER_CONTAINER:-voiceaichat-voicechat-1}
IDLE_TIMEOUT=${VC_REBUILD_IDLE_TIMEOUT:-3600}
IDLE_POLL=${VC_REBUILD_IDLE_POLL:-10}
HEALTH_URL=${VC_HEALTH_URL:-http://127.0.0.1:8787/api/health}
HEALTH_TRIES=${VC_HEALTH_TRIES:-60}   # × 5 с

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }

# Сколько ранов сейчас живы. Считаем прямо в БД сервера: активные статусы —
# queued/running/awaiting_input (см. CI_STATUSES в packages/shared/src/ci.ts).
# Пустой вывод = сервер недоступен, тогда и ранов быть не может.
active_runs() {
  docker exec "$SERVER_CONTAINER" node -e '
    const Db = require("/app/node_modules/better-sqlite3")
    const db = new Db("/data/voicechat.db", { readonly: true })
    const row = db.prepare("SELECT COUNT(*) AS n FROM ci_runs WHERE status IN (?, ?, ?)").get("queued", "running", "awaiting_input")
    console.log(row.n)
  ' 2>/dev/null | tr -d "[:space:]"
}

exec 9>"$LOCK"
if ! flock -w "$LOCK_WAIT" 9; then
  log "другая пересборка держит блокировку дольше ${LOCK_WAIT}с — выходим"
  exit 75
fi

cd "$REPO"
log "=== пересборка прода начата, HEAD $(git rev-parse --short HEAD) ==="

# Передаём серверу Git-метаданные ровно той ревизии, из которой строятся образы.
export VC_RELEASE_COMMIT=$(git rev-parse --short=12 HEAD)
task_ref=$(git log -1 --pretty=%s | grep -Eio 'chat(ai)?[-[:space:]]*[0-9]+' | grep -Eo '[0-9]+' | head -1 || true)
export VC_RELEASE_TASK=${task_ref:+chat-$task_ref}
log "метаданные релиза: commit=$VC_RELEASE_COMMIT task=${VC_RELEASE_TASK:-нет}"

# Этап 1. Сборка образов: контейнеры остаются старыми, раны не задеты.
log "docker compose build $BUILD_SERVICES"
# shellcheck disable=SC2086
docker compose build $BUILD_SERVICES
log "образы собраны"

# Этап 2. Ждём, пока не останется активных ранов.
waited=0
while :; do
  n=$(active_runs || true)
  if [[ -z $n ]]; then
    log "сервер недоступен — активных ранов быть не может, продолжаем"
    break
  fi
  if [[ $n == 0 ]]; then
    log "активных ранов нет (ждали ${waited}с)"
    break
  fi
  if (( waited >= IDLE_TIMEOUT )); then
    log "!!! за ${IDLE_TIMEOUT}с раны не закончились (сейчас активных: $n) — контейнеры не пересоздаю"
    log "образы уже собраны: поднять их можно позже (scripts/prod/rebuild-when-idle.sh или voicechat-deploy)"
    exit 75
  fi
  # Не `(( ... )) && log`: при ложном условии это вернуло бы 1 и set -e убил бы скрипт.
  if (( waited % 60 == 0 )); then log "активных ранов: $n — жду простоя (${waited}с из ${IDLE_TIMEOUT}с)"; fi
  sleep "$IDLE_POLL"
  waited=$(( waited + IDLE_POLL ))
done

# Этап 3. Пересоздание. Проверяем ещё раз прямо перед ним: окно, в которое новый
# ран успевает стартовать, сужается до секунд — совсем убрать его отсюда нельзя,
# мьютекс общего ресурса живёт в процессе сервера.
n=$(active_runs || true)
if [[ -n $n && $n != 0 ]]; then
  log "ран стартовал прямо перед пересозданием (активных: $n) — контейнеры не трогаю"
  exit 75
fi

log "docker compose up -d $UP_SERVICES"
# shellcheck disable=SC2086
docker compose up -d $UP_SERVICES
docker compose ps

for ((i = 1; i <= HEALTH_TRIES; i++)); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "=== прод поднялся: $(curl -fsS -m 5 "$HEALTH_URL") ==="
    exit 0
  fi
  sleep 5
done

log "!!! прод не ответил на $HEALTH_URL за $((HEALTH_TRIES * 5))с"
docker compose ps -a
docker compose logs --no-color --tail=50 voicechat || true
exit 1

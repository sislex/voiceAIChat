#!/usr/bin/env bash
# Деплой прода. Запускать на прод-хосте: `voicechat-deploy` (после scripts/prod/install.sh).
#
# Ключевое свойство — деплой переживает смерть родителя. Команда, пришедшая через
# канал «модель → сервер → агент» (MCP remote bash) или через ssh, живёт ограниченное
# время: агент убивает её SIGKILL по timeoutMs (по умолчанию 120 с, максимум 300 с),
# а ssh шлёт SIGHUP при обрыве. `docker compose up -d --build` за этот лимит не
# успевает, и убийство приходит в самую опасную точку: старый контейнер уже удалён,
# новый ещё не запущен → прод лежит, снаружи 502 от Caddy (инцидент 2026-07-30).
# Поэтому скрипт сразу перезапускает себя через setsid/nohup и возвращает управление:
# что бы ни случилось с каналом, деплой доходит до конца.

set -Eeuo pipefail

REPO=${VC_REPO_DIR:-/root/voiceAIChat}
LOG=${VC_DEPLOY_LOG:-/var/log/voicechat-deploy.log}
LOCK=${VC_DEPLOY_LOCK:-/var/lock/voicechat-deploy.lock}
HEALTH_URL=${VC_HEALTH_URL:-http://127.0.0.1:8787/api/health}
HEALTH_TRIES=${VC_HEALTH_TRIES:-60}   # × 5 с = до 5 минут на подъём

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }

# Первый проход: отцепиться от родителя и выйти. Передаём release metadata
# фоновой копии явно: защищённый release запускается через несколько shell/process
# границ, и простого наследования окружения недостаточно для надёжного контракта.
if [[ ${VC_DEPLOY_CHILD:-} != 1 ]]; then
  setsid nohup env \
    VC_DEPLOY_CHILD=1 \
    VC_RELEASE_VERSION="${VC_RELEASE_VERSION-}" \
    VC_RELEASE_SOURCE="${VC_RELEASE_SOURCE-}" \
    VC_RELEASED_AT="${VC_RELEASED_AT-}" \
    VC_RELEASE_COMMIT="${VC_RELEASE_COMMIT-}" \
    VC_RELEASE_TASK="${VC_RELEASE_TASK-}" \
    "$0" "$@" >>"$LOG" 2>&1 </dev/null &
  cat <<EOF
деплой запущен в фоне (pid $!) и не зависит от этой сессии
лог:     tail -f $LOG
статус:  docker compose -f $REPO/docker-compose.yml ps
здоровье: curl -s $HEALTH_URL
EOF
  exit 0
fi

# Второй проход — собственно деплой. Блокировка на дескрипторе: если процесс убьют,
# fd закроется и lock освободится сам (важно — деплой тут убивают регулярно).
exec 9>"$LOCK"
if ! flock -n 9; then
  log 'другой деплой уже идёт — выходим'
  exit 0
fi

cd "$REPO"
log "=== деплой начат, HEAD $(git rev-parse --short HEAD) ==="

log 'git pull --ff-only и git fetch --tags'
git pull --ff-only
git fetch --tags origin
log "HEAD после pull: $(git rev-parse --short HEAD)"

# Метаданные именно того коммита, из которого сейчас собирается приложение.
export VC_RELEASE_COMMIT=$(git rev-parse --short=12 HEAD)
release_tag=$(git tag --points-at HEAD --list 'v*' | grep -E "^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$" | sort -V | awk 'END { print }' || true)
# Защищённая публикация передаёт каноническую версию release-ветки. Для обычного
# деплоя источником служит строгий тег текущего HEAD; без обоих версия неизвестна.
if [[ -n ${VC_RELEASE_VERSION:-} ]]; then
  release_source=${VC_RELEASE_SOURCE:-explicit}
else
  export VC_RELEASE_VERSION=${release_tag:+${release_tag#v}}
  release_source=${VC_RELEASE_VERSION:+git-tag}
  release_source=${release_source:-unknown}
fi
task_ref=$(git log -1 --pretty=%s | grep -Eio 'chat(ai)?[-[:space:]]*[0-9]+' | grep -Eo '[0-9]+' | head -1 || true)
export VC_RELEASE_TASK=${task_ref:+chat-$task_ref}
log "метаданные релиза: version=${VC_RELEASE_VERSION:-неизвестна} source=$release_source commit=$VC_RELEASE_COMMIT task=${VC_RELEASE_TASK:-нет}"

log 'docker compose up -d --build'
docker compose up -d --build

log 'ждём /api/health'
for ((i = 1; i <= HEALTH_TRIES; i++)); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1; then
    log "=== деплой успешен: $(curl -fsS -m 5 "$HEALTH_URL") ==="
    exit 0
  fi
  sleep 5
done

log "!!! приложение не поднялось за $((HEALTH_TRIES * 5))с"
docker compose ps -a
docker compose logs --tail=50 voicechat || true
exit 1

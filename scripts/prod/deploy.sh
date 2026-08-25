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

if [[ -z ${VC_REPO_DIR:-} && -r /etc/voicechat/production.env ]]; then
  source /etc/voicechat/production.env
fi
: "${VC_REPO_DIR:?VC_REPO_DIR не задан; переустановите scripts/prod/install.sh}"
REPO=$VC_REPO_DIR
LOG=${VC_DEPLOY_LOG:-/var/log/voicechat-deploy.log}
LOCK=${VC_DEPLOY_LOCK:-/var/lock/voicechat-deploy.lock}
HEALTH_URL=${VC_HEALTH_URL:-http://127.0.0.1:8787/api/health}
HEALTH_TRIES=${VC_HEALTH_TRIES:-60}   # × 5 с = до 5 минут на подъём

log() { printf '[%s] %s\n' "$(date -Is)" "$*"; }

# Первый проход: отцепиться от родителя и выйти. Передаём release metadata
# явно: detached-процесс не должен зависеть от окружения вызывающей сессии.
if [[ ${VC_DEPLOY_CHILD:-} != 1 ]]; then
  release_version=${VC_RELEASE_VERSION-}
  release_version_source=${VC_RELEASE_VERSION_SOURCE:-${release_version:+explicit}}
  VC_DEPLOY_CHILD=1 setsid nohup "$0" \
    --release-version "$release_version" \
    --release-version-source "$release_version_source" \
    "$@" >>"$LOG" 2>&1 </dev/null &
  cat <<EOF
деплой запущен в фоне (pid $!) и не зависит от этой сессии
лог:     tail -f $LOG
статус:  docker compose -f $REPO/docker-compose.yml ps
здоровье: curl -s $HEALTH_URL
EOF
  exit 0
fi

# Второй проход получает канонические значения позиционно: это надёжная граница
# между вызывающей сессией и detached-процессом, независимо от сохранённого env.
if [[ ${1:-} == --release-version && ${3:-} == --release-version-source ]]; then
  export VC_RELEASE_VERSION=$2
  export VC_RELEASE_VERSION_SOURCE=$4
  shift 4
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
  release_version_source=${VC_RELEASE_VERSION_SOURCE:-explicit}
else
  export VC_RELEASE_VERSION=${release_tag:+${release_tag#v}}
  release_version_source=${release_tag:+git-tag}
  release_version_source=${release_version_source:-none}
fi
task_ref=$(git log -1 --pretty=%s | grep -Eio 'chat(ai)?[-[:space:]]*[0-9]+' | grep -Eo '[0-9]+' | head -1 || true)
export VC_RELEASE_TASK=${task_ref:+chat-$task_ref}
log "метаданные релиза: version=${VC_RELEASE_VERSION:-нет} commit=$VC_RELEASE_COMMIT task=${VC_RELEASE_TASK:-нет} source=$release_version_source"

# Канонический серверный том не зависит от Compose project name. До первого
# пересоздания безопасно переносим единственный прежний Compose-том vc-data.
data_volume=${VC_DATA_VOLUME:-voicechat-server-data}
backup_volume=${VC_DATA_BACKUP_VOLUME:-voicechat-server-data-backups}
files_image=${VC_DATA_FILES_IMAGE:-alpine:3.20}
sqlite_image=${VC_DATA_SQLITE_IMAGE:-python:3.12-alpine}

volume_nonempty() {
  docker run --rm -v "$1:/data:ro" "$files_image" sh -eu -c \
    'test -n "$(find /data -mindepth 1 -maxdepth 1 -print -quit)"'
}

validate_data_volume() {
  docker run --rm -v "$1:/data:ro" "$sqlite_image" python3 -c \
    'import os,sqlite3,stat
db="/data/voicechat.db"
secret="/data/session.secret"
for path in (db,secret):
 item=os.stat(path)
 assert stat.S_ISREG(item.st_mode), f"{path} is not a regular file"
 assert item.st_size > 0, f"{path} is empty"
connection=sqlite3.connect(f"file:{db}?mode=ro",uri=True)
result=connection.execute("PRAGMA integrity_check").fetchone()
connection.close()
assert result and result[0]=="ok", f"voicechat.db integrity_check: {result}"'
}

migration_error() {
  log "!!! миграция серверных данных: $*" >&2
  exit 1
}

log "проверяем постоянный том серверных данных $data_volume"
docker volume create "$data_volume" >/dev/null ||
  migration_error "не удалось создать или открыть постоянный том"

if volume_nonempty "$data_volume"; then
  validate_data_volume "$data_volume" ||
    migration_error "постоянный том непуст, но не содержит корректный комплект voicechat.db/session.secret"
  log 'постоянный том уже содержит корректные данные; миграция не требуется'
else
  volume_status=$?
  (( volume_status == 1 )) ||
    migration_error "не удалось проверить содержимое постоянного тома"
  legacy_output=$(docker volume ls --filter label=com.docker.compose.volume=vc-data --format '{{.Name}}') ||
    migration_error "не удалось получить список прежних Compose-томов"
  legacy_volumes=()
  while IFS= read -r volume; do
    [[ -n $volume ]] && legacy_volumes+=("$volume")
  done <<<"$legacy_output"

  nonempty_legacy=()
  for volume in "${legacy_volumes[@]}"; do
    [[ -n $volume && $volume != "$data_volume" ]] || continue
    if volume_nonempty "$volume"; then
      nonempty_legacy+=("$volume")
    else
      volume_status=$?
      (( volume_status == 1 )) ||
        migration_error "не удалось проверить содержимое прежнего тома $volume"
    fi
  done

  if (( ${#nonempty_legacy[@]} > 1 )); then
    migration_error "найдено несколько непустых прежних томов: ${nonempty_legacy[*]}"
  elif (( ${#nonempty_legacy[@]} == 0 )); then
    log 'прежние данные не найдены; разрешена чистая установка'
  else
    source_volume=${nonempty_legacy[0]}
    validate_data_volume "$source_volume" ||
      migration_error "прежний том $source_volume неполон или повреждён"

    docker volume create "$backup_volume" >/dev/null ||
      migration_error "не удалось создать том резервных копий"
    backup_id="$(date -u +%Y%m%dT%H%M%SZ)-$source_volume"
    docker run --rm -v "$source_volume:/source:ro" -v "$backup_volume:/backup" "$files_image" sh -eu -c \
      'mkdir "/backup/$1" && tar -C /source -czf "/backup/$1/data.tar.gz" . && tar -tzf "/backup/$1/data.tar.gz" >/dev/null' sh "$backup_id" ||
      migration_error "не удалось создать и проверить резервную копию $backup_id"
    log "резервная копия сохранена как $backup_volume/$backup_id/data.tar.gz"

    docker run --rm -v "$source_volume:/source:ro" -v "$data_volume:/target" "$files_image" sh -eu -c \
      'test -z "$(find /target -mindepth 1 -maxdepth 1 -print -quit)" && cp -a /source/. /target/' ||
      migration_error "не удалось скопировать данные в постоянный том"
    validate_data_volume "$data_volume" ||
      migration_error "скопированные данные не прошли итоговую проверку"
    log "данные однократно перенесены из $source_volume и проверены"
  fi
fi

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

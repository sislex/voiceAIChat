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

# Optional control-plane contract. Plain invocations retain the legacy launcher.
operation_id=
expected_commit=
operation_command=deploy
while (( $# )); do
  case "$1" in
    --operation-id) operation_id=${2:?}; shift 2 ;;
    --expected-commit) expected_commit=${2:?}; shift 2 ;;
    --status-operation) operation_id=${2:?}; operation_command=status; shift 2 ;;
    --reconcile-operation) operation_id=${2:?}; operation_command=reconcile; shift 2 ;;
    --release-version) export VC_RELEASE_VERSION=$2; shift 2 ;;
    --release-version-source) export VC_RELEASE_VERSION_SOURCE=$2; shift 2 ;;
    *) echo 'Unknown deployment argument' >&2; exit 64 ;;
  esac
done
if [[ -n $operation_id || -n $expected_commit ]]; then
  [[ $operation_id =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$ ]] || exit 64
  if [[ $operation_command == deploy ]]; then
    [[ $expected_commit =~ ^[a-f0-9]{40}$ ]] || exit 64
  fi
fi
export VC_RELEASE_VERSION_SOURCE=${VC_RELEASE_VERSION_SOURCE:-${VC_RELEASE_VERSION:+explicit}}
OPERATION_ROOT=${VC_DEPLOY_OPERATIONS:-/var/lib/voicechat/deploy-operations}

# Embedded in the content-addressed shell copy: git pull cannot replace journal
# code midway through a detached operation. No credential or raw health body is stored.
operation_record() {
  python3 - "$OPERATION_ROOT" "$operation_id" "$1" "$expected_commit" "$REPO" \
    "${VC_RELEASE_VERSION-}" "${VC_RELEASE_VERSION_SOURCE-}" "$$" "${2-}" "$HEALTH_URL" "$LOCK" <<'PYTHON'
import fcntl,json,os,pathlib,re,sys,tempfile,time
root,ident,action,expected,repo,version,source,pid,value,health,host_lock=sys.argv[1:]
root=pathlib.Path(root)
if not root.is_absolute() or root.resolve()!=root: raise SystemExit('operation_path_not_canonical')
if action!='status': root.mkdir(mode=0o700,parents=True,exist_ok=True)
st=root.stat()
if st.st_uid!=os.geteuid() or st.st_mode & 0o077: raise SystemExit('operation_directory_not_private')
path=root/(ident+'.json')
def read(p):
 if p.is_symlink(): raise SystemExit('operation_symlink_rejected')
 return json.loads(p.read_text())
def output(v): print(json.dumps(v,separators=(',',':')))
if action=='status': output(read(path)); sys.exit(0)
lock=root/'.lock'
fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'r+') as guard:
 fcntl.flock(guard,fcntl.LOCK_EX)
 request={'expectedCommit':expected,'repository':repo,'version':version,'versionSource':source,'healthUrl':health,'hostLock':host_lock}
 record=read(path) if path.exists() else None
 if action=='reserve':
  if record:
   if record['request']!=request: raise SystemExit('operation_identity_conflict')
   output(record);sys.exit(10)
  for other in root.glob('*.json'):
   if read(other)['state'] in ('accepted','running','uncertain'): raise SystemExit('unreconciled_operation_exists')
  record={'schemaVersion':1,'operationId':ident,'request':request,'state':'accepted','createdAt':int(time.time()*1000)}
 elif not record: raise SystemExit('operation_not_found')
 elif action=='start':
  if record['state']!='accepted' or record['request']!=request: raise SystemExit('operation_start_conflict')
  record.update(state='running',pid=int(pid),phase='preparing')
 elif action=='phase':
  if record['state']!='running' or record.get('pid')!=int(pid): raise SystemExit('operation_owner_changed')
  record.update(phase='deploying',previousCommit=value or None)
 elif action=='composed':
  if record['state']!='running' or record.get('pid')!=int(pid): raise SystemExit('operation_owner_changed')
  record['composeCompleted']=True
 elif action=='finish':
  if record['state'] not in ('accepted','running'): raise SystemExit('operation_terminal')
  code=int(value)
  if code==0 and record.get('phase')=='deploying': record['observedCommit']=expected
  record.update(state=('succeeded' if code==0 else 'uncertain') if record.get('phase')=='deploying' else 'failed',exitCode=code)
 elif action=='reconcile':
  if any(record['request'][k]!=request[k] for k in ('repository','healthUrl','hostLock')): raise SystemExit('operation_environment_changed')
  if record['state'] not in ('accepted','running','uncertain'): output(record);sys.exit(0)
  if record.get('phase')=='deploying' and not record.get('composeCompleted'): raise SystemExit('deployment_command_completion_unknown')
  if value==record['request']['expectedCommit']: record['state']='succeeded'
  elif value and value==record.get('previousCommit'): record['state']='recovered'
  else: raise SystemExit('observed_commit_does_not_resolve_operation')
  record.update(observedCommit=value,reconciled=True)
 else: raise SystemExit('operation_action_invalid')
 record['updatedAt']=int(time.time()*1000)
 fd,temp=tempfile.mkstemp(prefix='.write-',dir=root)
 try:
  with os.fdopen(fd,'w') as stream:
   json.dump(record,stream);stream.flush();os.fsync(stream.fileno())
  os.replace(temp,path)
  directory=os.open(root,os.O_RDONLY)
  try: os.fsync(directory)
  finally: os.close(directory)
 finally:
  if os.path.exists(temp): os.unlink(temp)
 output(record)
PYTHON
}
observed_commit() {
  curl -fsS -m 5 "$HEALTH_URL" | python3 -c 'import json,re,sys; h=json.load(sys.stdin); c=h.get("application",{}).get("commit",""); assert h.get("ok") is True and h.get("application",{}).get("applicationId")=="core" and re.fullmatch("[a-f0-9]{40}",c); print(c)'
}
if [[ $operation_command == status ]]; then operation_record status; exit; fi
if [[ $operation_command == reconcile ]]; then
  exec 9>"$LOCK"
  flock -n 9 || { echo 'Deployment still owns the host lock' >&2; exit 75; }
  cd "$REPO"
  observed=$(observed_commit)
  docker compose exec -T voicechat node /app/scripts/component-readiness.mjs >/dev/null
  operation_record reconcile "$observed"
  exit
fi

# Reserve idempotency before detaching. A lost launch response cannot start twice.
if [[ ${VC_DEPLOY_CHILD:-} != 1 ]]; then
  if [[ -n $operation_id ]]; then
    if operation_record reserve; then :; else
      code=$?; [[ $code == 10 ]] && exit 0; exit "$code"
    fi
  fi
  release_version=${VC_RELEASE_VERSION-}
  release_version_source=${VC_RELEASE_VERSION_SOURCE:-${release_version:+explicit}}
  launch_args=(--release-version "$release_version" --release-version-source "$release_version_source")
  [[ -z $operation_id ]] || launch_args+=(--operation-id "$operation_id" --expected-commit "$expected_commit")
  VC_DEPLOY_CHILD=1 setsid nohup "$0" "${launch_args[@]}" >>"$LOG" 2>&1 </dev/null &
  if [[ -z $operation_id ]]; then
    printf 'Deployment started (pid %s). Log: %s; health: %s\n' "$!" "$LOG" "$HEALTH_URL"
  fi
  exit 0
fi
if [[ -n $operation_id ]]; then
  trap 'code=$?; trap - EXIT; operation_record finish "$code" >/dev/null || true; exit "$code"' EXIT
fi

# Второй проход — собственно деплой. Блокировка на дескрипторе: если процесс убьют,
# fd закроется и lock освободится сам (важно — деплой тут убивают регулярно).
exec 9>"$LOCK"
if ! flock -n 9; then
  log 'другой деплой уже идёт — выходим'
  [[ -z $operation_id ]] || exit 75
  exit 0
fi

[[ -z $operation_id ]] || operation_record start >/dev/null
cd "$REPO"
log "=== деплой начат, HEAD $(git rev-parse --short HEAD) ==="

log 'git pull --ff-only и git fetch --tags'
git pull --ff-only
git fetch --tags origin
log "HEAD после pull: $(git rev-parse --short HEAD)"

if [[ -n $expected_commit ]]; then
  checkout_state=$(git status --porcelain --untracked-files=all)
  [[ $(git rev-parse HEAD) == "$expected_commit" && -z $checkout_state ]] || {
    log 'Expected clean commit does not match checkout; runtime unchanged'; exit 65;
  }
  previous=$(observed_commit) || { log 'Exact previous runtime is required'; exit 65; }
fi

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
# Read release-owned API/data metadata without deriving it from the operator environment.
export VC_APPLICATION_VERSION=$VC_RELEASE_VERSION
VC_APPLICATION_COMMIT=$(git rev-parse HEAD)
VC_APPLICATION_API_VERSION=$(python3 -c 'import json; print(json.load(open("apps/server/release.json"))["apiVersion"])')
VC_APPLICATION_DATA_VERSION=$(python3 -c 'import json; print(json.load(open("apps/server/release.json"))["dataVersion"])')
export VC_APPLICATION_COMMIT VC_APPLICATION_API_VERSION VC_APPLICATION_DATA_VERSION
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

if [[ -n $operation_id ]]; then
  operation_record phase "$previous" >/dev/null
fi
log 'docker compose up -d --build'
docker compose up -d --build
[[ -z $operation_id ]] || operation_record composed >/dev/null

log 'ждём /api/health'
for ((i = 1; i <= HEALTH_TRIES; i++)); do
  if curl -fsS -m 5 "$HEALTH_URL" >/dev/null 2>&1 &&
     docker compose exec -T voicechat node /app/scripts/component-readiness.mjs; then
    if [[ -n $expected_commit && $(observed_commit) != "$expected_commit" ]]; then
      log 'Healthy runtime does not match expected commit'; sleep 5; continue
    fi
    log "=== деплой успешен: $(curl -fsS -m 5 "$HEALTH_URL") ==="
    exit 0
  fi
  sleep 5
done

log "!!! приложение не поднялось за $((HEALTH_TRIES * 5))с"
docker compose ps -a
docker compose logs --tail=50 voicechat || true
exit 1

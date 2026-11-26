#!/usr/bin/env bash
set -euo pipefail
# Prepares the production host for deploy/compose.storage.yml (the file storage service and one blob node).
# Idempotent and restart-free: it creates the private token directory, the `storage` database and an
# environment block in production.env, and adds the overlay to COMPOSE_FILE. It never restarts a container;
# the final message names the command that applies the change. Secrets are never printed.
#
#   storage-provision.sh [--dry-run] [--env FILE] [--dir DIR] [--capacity-gb N] [--quota-mb N] [--port N]
[[ $EUID == 0 ]] || { echo 'storage-provision needs root' >&2; exit 1; }
ENV_FILE=/etc/voicechat/production.env DIR=/etc/voicechat/storage CAPACITY_GB=3 QUOTA_MB=100 PORT=8799 APPLY=1
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) APPLY=0 ;;
    --env) ENV_FILE=$2; shift ;;
    --dir) DIR=$2; shift ;;
    --capacity-gb) CAPACITY_GB=$2; shift ;;
    --quota-mb) QUOTA_MB=$2; shift ;;
    --port) PORT=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
for value in "$CAPACITY_GB" "$QUOTA_MB" "$PORT"; do [[ $value =~ ^[0-9]+$ ]] && (( value > 0 )) || { echo 'Numeric options must be positive integers' >&2; exit 2; }; done
[[ -r $ENV_FILE ]] || { echo "Cannot read $ENV_FILE" >&2; exit 1; }
step() { echo "$([[ $APPLY == 1 ]] || echo '[dry-run] ')$*"; }

# Reads one exported assignment from the environment file without sourcing it.
env_value() { python3 - "$ENV_FILE" "$1" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding='utf-8'):
    match = re.fullmatch(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)", line.rstrip('\n'))
    if match and match.group(1) == sys.argv[2]:
        value = match.group(2).split(' #')[0].strip()
        print(value[1:-1] if len(value) > 1 and value[0] in "'\"" and value[-1] == value[0] else value)
PY
}
REPO=$(env_value VC_REPO_DIR); DB_URL=$(env_value VC_DB_URL); PUBLIC_URL=$(env_value VC_PUBLIC_URL)
[[ -n $REPO && -f $REPO/deploy/compose.storage.yml ]] || { echo "deploy/compose.storage.yml is missing in $REPO: deploy a Core release that contains it first" >&2; exit 1; }
[[ $DB_URL =~ ^postgres(ql)?://([^:/@]+):([^@]*)@([^:/]+)(:[0-9]+)?/([^/?]+)$ ]] || { echo 'VC_DB_URL is not a postgres URL' >&2; exit 1; }
DB_USER=${BASH_REMATCH[2]} DB_PASS=${BASH_REMATCH[3]} DB_HOST=${BASH_REMATCH[4]} DB_PORT=${BASH_REMATCH[5]:-:5432} DB_NAME=${BASH_REMATCH[6]}
[[ $DB_PASS != *"'"* && $DB_PASS != *' '* ]] || { echo 'The database password has a quote or space: write the block by hand' >&2; exit 1; }
[[ -n $PUBLIC_URL ]] || { echo 'VC_PUBLIC_URL is not set in the environment file' >&2; exit 1; }
STORAGE_URL=$(python3 -c 'import sys,urllib.parse as u; p=u.urlsplit(sys.argv[1]); print(f"https://{p.hostname}:{sys.argv[2]}")' "$PUBLIC_URL" "$PORT")

# 1. Private directory and the three tokens (owner uid 1000, the user of the node images).
step "directory $DIR and tokens"
if [[ $APPLY == 1 ]]; then
  install -d -m 700 -o 1000 -g 1000 "$DIR"
  for name in node core-service app; do
    [[ -s $DIR/$name.token ]] || { umask 077; openssl rand -hex 32 > "$DIR/$name.token"; }
    chown 1000:1000 "$DIR/$name.token"; chmod 600 "$DIR/$name.token"
  done
fi

# 2. The `storage` database in the shared Postgres container.
PG=$(docker ps --filter label=com.docker.compose.service=postgres --format '{{.Names}}' | head -1)
[[ -n $PG ]] || { echo 'Postgres container not found' >&2; exit 1; }
if [[ $(docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -Atc "SELECT 1 FROM pg_database WHERE datname='storage'") == 1 ]]; then
  echo "database storage exists"
else
  step "create database storage"
  [[ $APPLY == 1 ]] && docker exec "$PG" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE storage OWNER '"$DB_USER" >/dev/null
fi

# 3. Environment block and the overlay in COMPOSE_FILE (a backup of the file is kept).
CORE=$(docker ps --filter label=com.docker.compose.service=voicechat --format '{{.Names}}' | head -1)
CURRENT_APPS=$(docker inspect "$CORE" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^VC_APPLICATIONS=//p' | head -1)
[[ -n $CURRENT_APPS ]] || { echo 'Core has no VC_APPLICATIONS' >&2; exit 1; }
APPS=$(printf '%s' "$CURRENT_APPS" | python3 -c 'import sys; items=[i for i in sys.stdin.read().split(",") if not i.startswith("storage")]; print(",".join(items))')",storage=$STORAGE_URL"
step "environment block in $ENV_FILE (applications: ${APPS})"
if [[ $APPLY == 1 ]]; then
  cp -p "$ENV_FILE" "$ENV_FILE.bak-storage-$(date +%Y%m%d%H%M%S)"
  python3 - "$ENV_FILE" "$DIR" "$DB_USER" "$DB_PASS" "$DB_HOST" "$DB_PORT" "$APPS" "$CAPACITY_GB" "$QUOTA_MB" "$REPO" <<'PY'
import re, sys
path, directory, user, password, host, port, apps, capacity_gb, quota_mb, repo = sys.argv[1:]
token = open(f'{directory}/app.token', encoding='utf-8').read().strip()
block = '\n'.join([
    '# >>> storage (managed by scripts/prod/storage-provision.sh)',
    f'export VC_STORAGE_DIR={directory}',
    f"export VC_STORAGE_DB_URL='postgres://{user}:{password}@{host}{port}/storage'",
    f"export VC_APPLICATIONS_WITH_STORAGE='{apps}'",
    f'export VC_APPLICATION_STORAGE_TOKEN={token}',
    f'export VC_STORAGE_QUOTA_BYTES={int(quota_mb) * 1024 * 1024}',
    f'export VC_STORAGE_CAPACITY_BYTES={int(capacity_gb) * 1024 ** 3}',
    '# <<< storage', ''])
text = open(path, encoding='utf-8').read()
text = re.sub(r'# >>> storage .*?# <<< storage\n', '', text, flags=re.S)
overlay = f'{repo}/deploy/compose.storage.yml'
def add(match):
    value = match.group(2)
    return match.group(0) if overlay in value.split(':') else f'{match.group(1)}{value}:{overlay}'
text, count = re.subn(r'^(export COMPOSE_FILE=)(.*)$', add, text, flags=re.M)
if count != 1: raise SystemExit('COMPOSE_FILE assignment not found exactly once')
open(path, 'w', encoding='utf-8').write(text.rstrip('\n') + '\n\n' + block)
PY
fi
echo
echo "Next (applies the change; Core restarts for a few seconds):"
echo "  set -a; . $ENV_FILE; set +a; cd \$VC_REPO_DIR && docker compose build storage-node && docker compose up -d storage storage-node voicechat caddy"

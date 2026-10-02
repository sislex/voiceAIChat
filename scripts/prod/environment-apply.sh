#!/usr/bin/env bash
# Apply an environment configuration on this machine: switch only the listed services to their
# published owner images, never build (docs/plans/environments.md, «Машинные скрипты»).
#
#   bash scripts/prod/environment-apply.sh --switches <file.json> --operation <id>
#
# file.json: {"<service>": "ghcr.io/sislex/<image>:<40-hex commit>", …}. Runs in the
# environment's compose checkout. Steps: pull every image (failure: exit 20, nothing switched);
# write the override and point current.yml at it; `up -d --no-build --no-deps` the services;
# wait until each is healthy. If one is not, current.yml returns to the previous override, the
# services go back to their previous images and the script exits 30. Each step prints one JSON
# line {"service","status","log"}; status is pulling|switching|healthy|failed|rolled_back.
set -Eeuo pipefail

docker=${DOCKER:-docker}
overrides=${VC_ENVIRONMENT_OVERRIDES:-/etc/voicechat/environment-overrides}
timeout=${VC_ENVIRONMENT_HEALTH_TIMEOUT:-180}
switches= operation=
while (( $# )); do
  case $1 in
    --switches) switches=${2:?}; shift 2 ;;
    --operation) operation=${2:?}; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -r $switches ]] || { echo 'switches file is required' >&2; exit 2; }
[[ $operation =~ ^[A-Za-z0-9_-]{1,80}$ ]] || { echo 'operation id is required' >&2; exit 2; }

# Docker Compose reads COMPOSE_FILE from the checkout's .env only when the process does not set
# it. Exporting a chain here would shadow that installed chain (production keeps it in .env), so
# resolve the base chain first: process value, then .env, then Compose's default file names.
base_chain=${COMPOSE_FILE:-}
if [[ -z $base_chain ]]; then
  base_chain=$(python3 - <<'PY'
import os, re
value = None
if os.path.isfile(".env"):
    for line in open(".env", encoding="utf-8").read().splitlines():
        match = re.match(r"^\s*(?:export\s+)?COMPOSE_FILE\s*=\s*(.*)$", line)
        if match:
            raw = match.group(1).strip()
            if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
                raw = raw[1:-1]
            value = raw
if value:
    print(value)
else:
    for name in ("compose.yaml", "compose.yml", "docker-compose.yml", "docker-compose.yaml"):
        if os.path.isfile(name):
            stem = name.rsplit(".", 1)
            files = [name] + [f"{stem[0]}.override.{ext}" for ext in ("yaml", "yml") if os.path.isfile(f"{stem[0]}.override.{ext}")][:1]
            print(":".join(files))
            break
PY
)
fi
[[ -n $base_chain ]] || { echo 'no compose chain in the environment, .env or checkout' >&2; exit 2; }
step() { python3 -c 'import json,sys; print(json.dumps({"service":sys.argv[1],"status":sys.argv[2],"log":sys.argv[3]}), flush=True)' "$1" "$2" "${3:-}"; }

# Only immutable published owner images; a typo must not become a mutable tag.
listing=$(python3 - "$switches" <<'PY'
import json, re, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
if not isinstance(data, dict) or not data:
    sys.exit("switches must be a non-empty object")
for service, reference in sorted(data.items()):
    if not re.fullmatch(r"[a-z][a-z0-9-]*", service) or service == "voicechat":
        sys.exit(f"invalid service {service}")
    if not re.fullmatch(r"ghcr\.io/sislex/[a-z0-9._-]+(:[a-f0-9]{40}|@sha256:[a-f0-9]{64})", reference):
        sys.exit(f"not an immutable owner image: {reference}")
    print(f"{service}\t{reference}")
PY
)
pairs=()
while IFS= read -r line; do [[ -n $line ]] && pairs+=("$line"); done <<< "$listing"

for pair in "${pairs[@]}"; do
  service=${pair%%$'\t'*} reference=${pair#*$'\t'}
  step "$service" pulling "$reference"
  if ! "$docker" pull "$reference" >/dev/null 2>&1; then
    step "$service" failed "pull failed: $reference"
    exit 20
  fi
done

install -d -m 0700 "$overrides"
current=$overrides/current.yml
previous=
[[ -L $current ]] && previous=$(readlink "$current")
override=$overrides/$operation.yml
{
  echo 'services:'
  # Keep earlier environment switches of services this operation does not touch.
  if [[ -n $previous && -r $previous ]]; then
    python3 - "$previous" "${pairs[@]}" <<'PY'
import re, sys
touched = {pair.split("\t", 1)[0] for pair in sys.argv[2:]}
service = None
for line in open(sys.argv[1], encoding="utf-8").read().splitlines()[1:]:
    match = re.match(r"^  ([a-z][a-z0-9-]*):$", line)
    if match:
        service = match.group(1)
    if service and service not in touched:
        print(line)
PY
  fi
  for pair in "${pairs[@]}"; do
    printf '  %s:\n    build: !reset null\n    image: "%s"\n    pull_policy: never\n' "${pair%%$'\t'*}" "${pair#*$'\t'}"
  done
} > "$override.tmp"
chmod 0600 "$override.tmp"
mv -f "$override.tmp" "$override"
ln -sfn "$override" "$current"

case ":$base_chain:" in *":$current:"*) export COMPOSE_FILE=$base_chain ;; *) export COMPOSE_FILE="$base_chain:$current" ;; esac
services=()
for pair in "${pairs[@]}"; do services+=("${pair%%$'\t'*}"); done

rollback() {
  if [[ -n $previous ]]; then ln -sfn "$previous" "$current"; else rm -f "$current"; fi
  "$docker" compose up -d --no-build --no-deps "${services[@]}" >/dev/null 2>&1 || true
  for service in "${services[@]}"; do step "$service" rolled_back "${1:-}"; done
}

for service in "${services[@]}"; do step "$service" switching ""; done
if ! "$docker" compose up -d --no-build --no-deps "${services[@]}" >/dev/null 2>&1; then
  rollback 'compose up failed'
  exit 30
fi

for service in "${services[@]}"; do
  healthy=0
  for (( waited = 0; waited <= timeout; waited += 3 )); do
    container=$("$docker" compose ps -q "$service" 2>/dev/null | head -1)
    state=$([[ -n $container ]] && "$docker" inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container" 2>/dev/null || echo 'missing none')
    case $state in
      'running healthy'|'running none') healthy=1; break ;;
      exited*|dead*|*' unhealthy') break ;;
    esac
    sleep 3
  done
  if (( healthy )); then
    step "$service" healthy "$state"
  else
    step "$service" failed "$state"
    rollback "$service not healthy: $state"
    exit 30
  fi
done

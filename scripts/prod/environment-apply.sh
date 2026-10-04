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

# Resolve checkout settings before pulling or changing any service.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
base_chain=$(python3 "$script_dir/compose_env.py" chain) || exit 2
overrides=${VC_ENVIRONMENT_OVERRIDES:-}
if [[ -z $overrides ]]; then
  overrides=$(python3 "$script_dir/compose_env.py" get VC_ENVIRONMENT_OVERRIDES) || exit 2
fi
overrides=${overrides:-/etc/voicechat/environment-overrides}
# A managed stand records its full chain, including the generated link, LAN and balancer
# overlays that are not in .env; without them a switched service loses its published ports.
if [[ -z ${COMPOSE_FILE:-} && -r $overrides/stand-chain ]]; then
  base_chain=$(<"$overrides/stand-chain")
fi
[[ -n $base_chain ]] || { echo "no compose chain in the environment, .env or checkout" >&2; exit 2; }
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
  # Owner images are amd64-only; an arm64 machine (Apple Silicon) pulls them for emulation.
  if ! pull_error=$("$docker" pull "$reference" 2>&1 >/dev/null) &&
     ! { [[ $pull_error == *"no matching manifest"* ]] && "$docker" pull --platform linux/amd64 "$reference" >/dev/null 2>&1; }; then
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

# Keep current.yml last and present exactly once, including on repeated apply.
COMPOSE_FILE=$(python3 - "$base_chain" "$current" <<'PY'
import sys
files = [name for name in sys.argv[1].split(":") if name != sys.argv[2]]
print(":".join(files + [sys.argv[2]]))
PY
)
export COMPOSE_FILE
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

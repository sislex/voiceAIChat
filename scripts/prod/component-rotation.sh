#!/usr/bin/env bash
set -euo pipefail
# Install without rerunning install.sh (which replaces the operator environment).
if [[ ${1:-} == --install ]]; then
  [[ $EUID == 0 ]] || { echo 'Timer installation requires root' >&2; exit 1; }
  rotation_repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
  install -d -m 755 /usr/local/lib/voicechat
  install -m 755 "$rotation_repo/scripts/prod/component-rotation.sh" /usr/local/lib/voicechat/component-rotation.sh
  install -m 644 "$rotation_repo/deploy/voicechat-component-rotation.service" /etc/systemd/system/
  install -m 644 "$rotation_repo/deploy/voicechat-component-rotation.timer" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now voicechat-component-rotation.timer
  exit 0
fi

# Renews component tokens through the running provider containers.
#
# The host has no Node runtime and the installation mixes directories and symlinks, so the
# rotation runs where the token registries live: each provider container issues a replacement
# into its own writable registry directory (outgoing mounts are read-only), and the host moves it
# into the consumer's outgoing directory with the original owner and mode. Only consumers whose
# newest active token from a provider expires within DAYS are renewed; they are restarted at the
# end so they read the new file. Token values are never printed.
#
#   component-rotation.sh [--dry-run] [--days N] [--pair consumer->provider] [--project compose-project]
#
# --project limits the run to one Compose project, so two installations on one host never mix.
[[ $EUID == 0 ]] || { echo 'Component rotation needs root (docker and installation files)' >&2; exit 1; }
DAYS=7 APPLY=1 PAIR= PROJECT=
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) APPLY=0 ;;
    --days) DAYS=$2; shift ;;
    --pair) PAIR=$2; shift ;;
    --project) PROJECT=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ $DAYS =~ ^[0-9]+$ ]] && (( DAYS > 0 && DAYS <= 365 )) || { echo 'Invalid --days' >&2; exit 2; }
exec 9>/run/voicechat-component-rotation.lock
flock -n 9 || { echo 'Another component rotation is running' >&2; exit 1; }

mount_source() { docker inspect "$1" --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{.Source}}{{end}}{{end}}"; }

declare -A APP_CONTAINER=()
for c in $(docker ps ${PROJECT:+--filter "label=com.docker.compose.project=$PROJECT"} --format '{{.Names}}'); do
  config=$(mount_source "$c" /run/sislexa/config.json)
  [[ -n $config ]] || continue
  APP_CONTAINER[$(basename "$(dirname "$config")")]=$c
done

# Runs the provider's token CLI as the registry owner; prints one JSON line or "ERROR: …".
token_command() {
  local container=$1 owner=$2; shift 2
  local args; args=$(printf "'%s'," "$@")
  docker exec --user "$owner" "$container" sh -c "cd /app && cli=\$(ls node_modules/@sislexa/component-runtime/src/cli.ts packages/component-runtime/src/cli.ts 2>/dev/null | head -1) && printf %s \"import { runTokenCommand } from '/app/\$cli'; try { console.log(JSON.stringify(runTokenCommand([${args%,}]))) } catch (e) { console.log('ERROR: ' + (e as Error).message) }\" > /tmp/component-token.mts && node --import tsx /tmp/component-token.mts 2>/dev/null; rm -f /tmp/component-token.mts"
}

now_ms=$(( $(date +%s) * 1000 )); horizon_ms=$(( now_ms + DAYS * 86400000 ))
restart=() failed=0
for consumer in "${!APP_CONTAINER[@]}"; do
  outgoing=$(mount_source "${APP_CONTAINER[$consumer]}" /run/sislexa/outgoing)
  [[ -n $outgoing ]] || continue
  outgoing=$(readlink -f "$outgoing")
  for file in "$outgoing"/*.token; do
    [[ -f $file ]] || continue
    provider=$(basename "$file" .token)
    [[ -z $PAIR || $PAIR == "$consumer->$provider" ]] || continue
    pc=${APP_CONTAINER[$provider]:-}
    [[ -n $pc ]] || { echo "skip $consumer->$provider: provider is not running"; continue; }
    registry=$(readlink -f "$(mount_source "$pc" /run/sislexa/provider)")
    [[ -d $registry ]] || { echo "skip $consumer->$provider: provider has no registry"; continue; }
    owner=$(stat -c %u:%g "$registry")
    contract=$(docker exec "$pc" sh -c "cd /app && for f in component-contract.json apps/*/component-contract.json packages/*/component-contract.json; do [ -f \"\$f\" ] && grep -q '\"applicationId\": *\"$provider\"' \"\$f\" && { echo \"/app/\$f\"; break; }; done")
    [[ -n $contract ]] || { echo "FAIL $consumer->$provider: no provider contract"; failed=1; continue; }
    listing=$(token_command "$pc" "$owner" list --contract "$contract" --config /run/sislexa/config.json)
    if [[ $listing == ERROR:* || -z $listing ]]; then echo "FAIL $consumer->$provider: list ${listing:-failed}"; failed=1; continue; fi
    newest=$(printf '%s' "$listing" | python3 -c 'import json,sys; c=sys.argv[1]; print(max([t["expiresAt"] for t in json.load(sys.stdin) if t["consumerId"]==c] or [0]))' "$consumer")
    (( newest > horizon_ms )) && continue
    grant=$(docker exec "$pc" node -e 'const c=JSON.parse(require("fs").readFileSync("/run/sislexa/config.json","utf8"));const g=(c.grants||[]).find(x=>x.consumerId===process.argv[1]);if(!g)process.exit(4);console.log(g.scopes.join(",")+" "+g.maxTtlSeconds)' "$consumer") \
      || { echo "FAIL $consumer->$provider: provider has no grant"; failed=1; continue; }
    echo "$([[ $APPLY == 1 ]] && echo renew || echo would_renew) $consumer->$provider (expires $(date -u -d @$((newest / 1000)) +%FT%RZ))"
    [[ $APPLY == 1 ]] || continue
    tmp=".rotation-$consumer-$(date +%s).token"
    issued=$(token_command "$pc" "$owner" issue --contract "$contract" --config /run/sislexa/config.json \
      --consumer "$consumer" --scopes "${grant% *}" --ttl "${grant#* }" --out "/run/sislexa/provider/$tmp")
    if [[ $issued == ERROR:* || -z $issued ]]; then echo "FAIL $consumer->$provider: issue ${issued:-failed}"; rm -f "$registry/$tmp"; failed=1; continue; fi
    file_owner=$(stat -c %u:%g "$file"); file_mode=$(stat -c %a "$file")
    cp -p "$file" "$file.previous"
    chown "$file_owner" "$registry/$tmp"; chmod "$file_mode" "$registry/$tmp"
    mv "$registry/$tmp" "$file"
    echo "  renewed until $(printf '%s' "$issued" | python3 -c 'import json,sys,datetime; print(datetime.datetime.utcfromtimestamp(json.load(sys.stdin)["expiresAt"]/1000).strftime("%FT%RZ"))')"
    restart+=("${APP_CONTAINER[$consumer]}")
  done
done
if (( ${#restart[@]} )); then
  mapfile -t unique < <(printf '%s\n' "${restart[@]}" | sort -u)
  echo "restarting ${unique[*]}"
  docker restart "${unique[@]}" >/dev/null
fi
exit $failed

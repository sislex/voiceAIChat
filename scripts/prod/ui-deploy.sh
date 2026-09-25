#!/usr/bin/env bash
# UI-only deployment uses the existing Core container and persistent data volume.
set -Eeuo pipefail
if [[ -z ${VC_REPO_DIR:-} && -r /etc/voicechat/production.env ]]; then
  source /etc/voicechat/production.env
fi
: "${VC_REPO_DIR:?VC_REPO_DIR is required}"
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$VC_REPO_DIR"
if [[ ${1:-} == delivery || ${1:-} == delivery-status ]]; then
  action=$1; shift
  # The owner takes its existing lock. The verifier/operation journal executes
  # under the same inherited open-file description, never a nested lock.
  exec 9>"${VC_DEPLOY_LOCK:-/var/lock/voicechat-deploy.lock}"
  flock -n 9 || { echo 'Another Core/UI deployment is running' >&2; exit 75; }
  exec python3 "$script_dir/ui-delivery.py" "$action" "$@"
fi
container=$(docker compose ps -q voicechat)
[[ -n $container ]] || { echo 'Core is not running' >&2; exit 1; }
command=${1:-status}
if (( $# )); then shift; fi
if [[ $command != status ]]; then
  exec 9>"${VC_DEPLOY_LOCK:-/var/lock/voicechat-deploy.lock}"
  flock -n 9 || { echo 'Another Core/UI deployment is running' >&2; exit 1; }
fi
if [[ $command == install ]]; then
  source_dir=${1:?Expected an owner-built browser artifact directory}
  source_dir=$(cd -- "$source_dir" && pwd)
  [[ -d $source_dir && -f $source_dir/manifest.json ]] || { echo 'Browser artifact directory is missing' >&2; exit 1; }
  # Copy to a disposable container directory; validation publishes immutable data.
  staging=$(docker exec --user node "$container" mktemp -d /tmp/browser-ui.XXXXXXXX)
  trap 'docker exec "$container" rm -rf -- "$staging" >/dev/null 2>&1 || true' EXIT
  docker cp "$source_dir/." "$container:$staging/"
  docker exec "$container" chown -R -h node:node "$staging"
  docker exec --user node "$container" node --import tsx scripts/browser-ui-release.mjs install --directory "$staging" --actor "${SUDO_USER:-${USER:-server-deploy}}"
else
  docker exec --user node "$container" node --import tsx scripts/browser-ui-release.mjs "$command" "$@" --actor "${SUDO_USER:-${USER:-server-deploy}}"
fi

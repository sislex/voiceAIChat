#!/usr/bin/env bash
# Release-manager entrypoint: bind the selected checkout to its installed Compose
# chain and keep independently owned services on their running local images.
set -Eeuo pipefail

: "${VC_RELEASE_VERSION:?Release version is required}"
: "${VC_RELEASE_EXPECTED_COMMIT:?Selected release SHA is required}"
[[ $VC_RELEASE_EXPECTED_COMMIT =~ ^[a-f0-9]{40}$ ]]
checkout=$(pwd -P)
[[ "$(git rev-parse HEAD)" == "$VC_RELEASE_EXPECTED_COMMIT" ]]
[[ -z "$(git status --porcelain --untracked-files=no)" ]]
[[ "$(git branch --show-current)" == "release/$VC_RELEASE_VERSION" ]]

[[ -r /etc/voicechat/production.env ]]
set -a
source /etc/voicechat/production.env
set +a
: "${VC_REPO_DIR:?Installed production checkout is required}"
: "${COMPOSE_FILE:?Installed Compose chain is required}"
old=$VC_REPO_DIR
if [[ $old != "$checkout" ]]; then
  [[ $COMPOSE_FILE == *"$old"* ]]
  export COMPOSE_FILE=${COMPOSE_FILE//"$old"/"$checkout"}
fi
export VC_REPO_DIR=$checkout
export VC_RELEASE_VERSION_SOURCE=release-manager

root=/etc/voicechat/release-overrides
install -d -m 0700 "$root"
operation="release-${VC_RELEASE_VERSION}-${VC_RELEASE_EXPECTED_COMMIT:0:12}-$(date +%s%N)"
override="$root/$operation.yml"
config=$(mktemp "$root/.compose-XXXXXXXX.json")
trap 'rm -f -- "$config"' EXIT
docker compose config --format json > "$config"
python3 scripts/prod/local_image_pins.py < "$config" > "$override"
chmod 0600 "$override"
export COMPOSE_FILE="$COMPOSE_FILE:$override"
docker compose config --format json | python3 -c '
import json,sys
s=json.load(sys.stdin)["services"]
assert "build" in s["voicechat"], "Core must build from the selected checkout"
assert all("build" not in v and v.get("pull_policy")=="never" for k,v in s.items() if k!="voicechat"), "A dependent service would build or pull"
'
echo "Release source verified: $VC_RELEASE_VERSION ${VC_RELEASE_EXPECTED_COMMIT:0:12}; owner images pinned locally"
/usr/local/bin/voicechat-deploy --operation-id "$operation" --expected-commit "$VC_RELEASE_EXPECTED_COMMIT" --release-version "$VC_RELEASE_VERSION" --release-version-source release-manager

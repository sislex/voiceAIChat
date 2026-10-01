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
# Environment switches (environment-apply.sh) stay in the chain: a Core release must not revert
# a service the environment configuration moved; the running-image pins below keep it anyway.
environment_current=${VC_ENVIRONMENT_OVERRIDES:-/etc/voicechat/environment-overrides}/current.yml
if [[ -L $environment_current && -r $environment_current ]]; then
  case ":$COMPOSE_FILE:" in *":$environment_current:"*) ;; *) export COMPOSE_FILE="$COMPOSE_FILE:$environment_current" ;; esac
fi
export VC_RELEASE_VERSION_SOURCE=release-manager

root=/etc/voicechat/release-overrides
install -d -m 0700 "$root"
operation="release-${VC_RELEASE_VERSION}-${VC_RELEASE_EXPECTED_COMMIT:0:12}-$(date +%s%N)"
override="$root/$operation.yml"
config=$(mktemp "$root/.compose-XXXXXXXX.json")
trap 'rm -f -- "$config"' EXIT
docker compose config --format json > "$config"
# A composed release moves owner images on purpose: pull exactly those before pinning, so `up`
# itself still neither builds nor pulls, and a missing image stops the deploy before any switch.
switches=$(mktemp "$root/.switches-XXXXXXXX.json")
trap 'rm -f -- "$config" "$switches"' EXIT
python3 scripts/prod/owner_image_switches.py > "$switches"
while IFS=$'\t' read -r service reference; do
  [[ -n $service ]] || continue
  echo "Owner image changed by the release: $service -> $reference"
  docker pull "$reference"
done < <(python3 -c 'import json,sys; [print(f"{k}\t{v}") for k,v in json.load(open(sys.argv[1])).items()]' "$switches")
python3 scripts/prod/local_image_pins.py --switches "$switches" < "$config" > "$override"
chmod 0600 "$override"
export COMPOSE_FILE="$COMPOSE_FILE:$override"
docker compose config --format json | python3 -c '
import json,sys
s=json.load(sys.stdin)["services"]
assert "build" in s["voicechat"], "Core must build from the selected checkout"
assert all("build" not in v and v.get("pull_policy")=="never" for k,v in s.items() if k!="voicechat"), "A dependent service would build or pull"
'
echo "Release source verified: $VC_RELEASE_VERSION ${VC_RELEASE_EXPECTED_COMMIT:0:12}; owner images pinned locally, release-moved images: $(python3 -c 'import json,sys; print(", ".join(json.load(open(sys.argv[1]))) or "none")' "$switches")"
/usr/local/bin/voicechat-deploy --operation-id "$operation" --expected-commit "$VC_RELEASE_EXPECTED_COMMIT" --release-version "$VC_RELEASE_VERSION" --release-version-source release-manager

#!/usr/bin/env bash
set -euo pipefail
# Builds the storage service image for THIS host's architecture from sislex/storage (the published ghcr
# image is arm64-only). Clones the private repository with VC_GITHUB_TOKEN from production.env (never
# printed, not left in the clone), builds the pinned commit and prints the image tag for
# `storage-provision.sh --storage-image`.
#
#   storage-image-build.sh [--commit SHA] [--env FILE]
[[ $EUID == 0 ]] || { echo 'storage-image-build needs root' >&2; exit 1; }
COMMIT=21e7265b51ebcce281160bd9340c76a328e7fa62 ENV_FILE=/etc/voicechat/production.env
while [[ $# -gt 0 ]]; do
  case $1 in
    --commit) COMMIT=$2; shift ;;
    --env) ENV_FILE=$2; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || { echo 'The commit must be a full 40-character SHA' >&2; exit 2; }
TOKEN=$(python3 - "$ENV_FILE" <<'PY'
import re, sys
for line in open(sys.argv[1], encoding='utf-8'):
    match = re.fullmatch(r"\s*(?:export\s+)?VC_GITHUB_TOKEN=(.*)", line.rstrip('\n'))
    if match:
        value = match.group(1).split(' #')[0].strip()
        print(value[1:-1] if len(value) > 1 and value[0] in "'\"" and value[-1] == value[0] else value)
PY
)
[[ -n $TOKEN ]] || { echo 'VC_GITHUB_TOKEN is not set in the environment file' >&2; exit 1; }
TAG=sislexa-storage:${COMMIT:0:12}
if docker image inspect "$TAG" >/dev/null 2>&1; then echo "$TAG"; exit 0; fi
WORK=$(mktemp -d /root/storage-build.XXXXXX); trap 'rm -rf "$WORK"' EXIT
git -c credential.helper= -c http.extraheader="Authorization: Basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')" clone --quiet https://github.com/sislex/storage.git "$WORK/src"
git -C "$WORK/src" checkout --quiet "$COMMIT"
docker build --quiet -f "$WORK/src/apps/service/Dockerfile" -t "$TAG" "$WORK/src" >/dev/null
echo "$TAG"

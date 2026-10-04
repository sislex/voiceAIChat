#!/usr/bin/env bash
set -euo pipefail
umask 077
since=''
if [[ ${1:-} == --since ]]; then
  [[ $# -ge 3 && -n $2 ]] || exit 2
  since=$2
  shift 2
fi
if [[ $# -ne 1 || ! -d $1 ]]; then
  printf '{"stage":"files-snapshot","status":"failed","log":"usage: [--since timestamp] directory"}\n'
  exit 2
fi
out_dir=$(cd "$1" && pwd -P)
out=$(mktemp "$out_dir/environment-files.XXXXXX")
cleanup() {
  if [[ -z ${completed:-} ]]; then
    rm -f -- "$out"
    printf '{"stage":"files-snapshot","status":"failed","log":"archive failed"}\n'
  fi
}
trap cleanup EXIT
printf '{"stage":"files-snapshot","status":"running","log":""}\n'
args=(tar --create --numeric-owner --file=- --directory=/data)
[[ -z $since ]] || args+=("--newer=$since")
# GNU tar --newer includes mtime and ctime, including metadata-only changes.
"${DOCKER:-docker}" volume inspect voicechat-server-data >/dev/null
"${DOCKER:-docker}" run --rm --network none --read-only \
  --mount type=volume,src=voicechat-server-data,dst=/data,readonly \
  debian:bookworm-slim "${args[@]}" . > "$out"
chmod 0600 "$out"
python3 - "$out" "$since" <<'PY'
import hashlib, json, os, sys
sha = hashlib.sha256()
with open(sys.argv[1], 'rb') as source:
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        sha.update(chunk)
print(json.dumps(dict(stage='files-snapshot', status='passed', log='', path=sys.argv[1],
                     size=os.path.getsize(sys.argv[1]), sha256=sha.hexdigest(), since=sys.argv[2] or None)))
PY
completed=1

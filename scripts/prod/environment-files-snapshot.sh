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
# The archive streams through the container's stdout: without --log-driver none Docker also
# writes it into the container's JSON log, doubling the disk use (U04 filled the production disk).
run=("${DOCKER:-docker}" run --rm --log-driver none --network none --read-only
  --mount type=volume,src=voicechat-server-data,dst=/data,readonly debian:bookworm-slim)
# Refuse before writing when the archive cannot fit with a margin (1 GiB or 10 %).
need_kb=$("${run[@]}" du -sk --apparent-size /data | awk 'NR==1{print $1}')
free_kb=$(df -Pk "$out_dir" | awk 'NR==2{print $4}')
[[ $need_kb =~ ^[0-9]+$ && $free_kb =~ ^[0-9]+$ ]] || exit 4
margin_kb=$(( need_kb / 10 > 1048576 ? need_kb / 10 : 1048576 ))
if (( free_kb < need_kb + margin_kb )); then
  completed=1; rm -f -- "$out"
  printf '{"stage":"files-snapshot","status":"failed","log":"insufficient disk space: need %s KiB plus %s KiB margin, free %s KiB"}\n' "$need_kb" "$margin_kb" "$free_kb"
  exit 3
fi
"${run[@]}" "${args[@]}" . > "$out"
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

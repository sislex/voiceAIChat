#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  printf '{"stage":"snapshot","status":"failed","log":"output directory is required"}\n'
  exit 2
fi

out_dir=$(cd "$1" && pwd -P)
umask 077
out=$(mktemp "$out_dir/environment-snapshot.XXXXXX")
cleanup() { if [[ -z ${completed:-} ]]; then rm -f -- "$out"; fi; }
trap cleanup EXIT

printf '{"stage":"snapshot","status":"running","log":""}\n'
args=(pg_dump -U "${POSTGRES_USER:-voicechat}" -d "${POSTGRES_DB:-voicechat}" -Fc)
while IFS= read -r table; do
  [[ -z "$table" || "$table" == \#* ]] && continue
  [[ "$table" =~ ^[a-z][a-z0-9_]*$ ]] || exit 2
  args+=("--exclude-table-data=public.$table")
done < "$(dirname "$0")/snapshot-exclude.txt"
docker compose exec -T postgres "${args[@]}" > "$out"
chmod 0600 "$out"
size=$(wc -c < "$out" | tr -d ' ')
completed=1
python3 - "$out" "$size" <<'PY'
import hashlib, json, sys
with open(sys.argv[1], 'rb') as source:
    sha = hashlib.sha256(source.read()).hexdigest()
print(json.dumps({'stage':'snapshot','status':'passed','log':'','path':sys.argv[1],
                  'size':int(sys.argv[2]),'sha256':sha}, separators=(',', ':')))
PY

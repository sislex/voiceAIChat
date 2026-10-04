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
listed=()
while IFS= read -r table; do
  [[ -z "$table" || "$table" == \#* ]] && continue
  [[ "$table" =~ ^[a-z][a-z0-9_]*$ ]] || exit 2
  listed+=("'$table'")
done < "$(dirname "$0")/snapshot-exclude.txt"
# Rows that reference an excluded table through a foreign key cannot be restored
# without it (pg_restore then fails), so their data is excluded as well, recursively.
closure="WITH RECURSIVE ex(oid) AS (
  SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[$(IFS=,; printf '%s' "${listed[*]}")]::text[])
  UNION SELECT k.conrelid FROM pg_constraint k JOIN ex ON k.confrelid = ex.oid WHERE k.contype = 'f'
) SELECT DISTINCT c.relname FROM ex JOIN pg_class c ON c.oid = ex.oid
  JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' ORDER BY 1"
tables=$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-voicechat}" -d "${POSTGRES_DB:-voicechat}" -Atq -c "$closure")
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  [[ "$table" =~ ^[a-z][a-z0-9_]*$ ]] || exit 2
  args+=("--exclude-table-data=public.$table")
done <<< "$tables"
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

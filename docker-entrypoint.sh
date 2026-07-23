#!/bin/sh
# Стартуем под root: чиним владельца тома данных (мог быть создан прежним
# root-контейнером → node не смог бы писать, SQLITE_READONLY), затем роняем
# привилегии до node (claude CLI запрещает bypass-права под root).
set -e

chown -R node:node /data 2>/dev/null || true

exec gosu node "$@"

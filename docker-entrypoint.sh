#!/bin/sh
# Стартуем под root: чиним владельца томов (могли быть созданы прежним
# root-контейнером → node не смог бы писать, SQLITE_READONLY / auth недоступна),
# затем роняем привилегии до node (claude CLI запрещает bypass-права под root).
set -e

# Данные (SQLite + вложения) и авторизация CLI (тома vc-claude/vc-codex) —
# во владении node, иначе node не сможет писать/читать токены.
mkdir -p /home/node/.claude /home/node/.codex
chown -R node:node /data /home/node/.claude /home/node/.codex 2>/dev/null || true

exec gosu node "$@"

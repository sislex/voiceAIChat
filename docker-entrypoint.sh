#!/bin/sh
# Стартуем под root: чиним владельца томов и, при необходимости, переносим старые
# CLI-профили в отдельный data-volume исполнителя. Затем сбрасываем привилегии до
# node: claude CLI не даёт bypass-права под root/sudo.
set -e

DATA_DIR=${VC_DATA_DIR:-/data}
HOME_DIR=${HOME:-/home/node}
CLAUDE_DIR="$HOME_DIR/.claude"
CODEX_DIR="$HOME_DIR/.codex"

mkdir -p "$DATA_DIR" "$CLAUDE_DIR" "$CODEX_DIR"

MIGRATE_FROM=${VC_RUNNER_MIGRATE_CLI_USERS_FROM:-}
if [ -n "$MIGRATE_FROM" ]; then
  SRC="$MIGRATE_FROM/cli-users"
  DST="$DATA_DIR/cli-users"
  if [ -d "$SRC" ] && [ ! -e "$DST/.migrated-from-server-data" ]; then
    mkdir -p "$DST"
    if [ -z "$(ls -A "$DST" 2>/dev/null)" ]; then
      cp -a "$SRC/." "$DST/" 2>/dev/null || true
    fi
    touch "$DST/.migrated-from-server-data"
  fi
fi

chown -R node:node "$DATA_DIR" "$CLAUDE_DIR" "$CODEX_DIR" 2>/dev/null || true

exec gosu node "$@"

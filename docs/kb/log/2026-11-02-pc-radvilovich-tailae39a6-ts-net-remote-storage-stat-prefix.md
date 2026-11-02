---
title: remote-storage-stat-prefix
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# remote-storage-stat-prefix

## Verified change

Reviewed commit `0234c1a95` against the tracked areas of `server-internals.md`.
Remote `statFile` now lists the parent directory, omits the prefix for root files,
and matches the exact path. Missing entries still raise `not_found` (404).

## Evidence

- `apps/server/src/fileStorage/remote.ts`: parent prefix selection and exact match.
- `packages/shared/src/fileStorage.ts`: `normalizeStoragePrefix` appends `/`.
- `packages/file-storage/src/service.ts`: listing filters paths with the normalized prefix.
- `apps/server/src/fileStorage/remote.test.ts`: root/nested stat and read, missing entries,
  and conditional GET; focused run passed all seven tests.

## Knowledge update

Updated `docs/kb/server-internals.md#core-file-storage` and refreshed its checked
marker through the KB CLI. `npm run kb:check -- --strict` passed.
The supervisor's task gate had already returned exit code 0; the failed step
was the subsequent KB freshness check.

## Remaining work

None for this documentation repair.

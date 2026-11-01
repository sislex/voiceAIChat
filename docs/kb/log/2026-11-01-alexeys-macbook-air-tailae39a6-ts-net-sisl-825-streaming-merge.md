---
title: sisl-825-streaming-merge
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# sisl-825-streaming-merge

## Merge resolution

Merged the locally available origin/SISL-811 (5343eff3b) into the assigned dev-based
checkout (62e7641be), without committing. Fetch was denied by the GitHub network
allowlist. Preserved source streaming PUT/GET, undici pooling, configurable 1 GiB
file default and both branches tests. Retained direct URLs/commit, resumable
sessions and reservations, batch, cache validators, Range, compression and thumbnails.
Parts, direct PUTs and batch inputs retain their independent 64 MiB bounds.
Added 200 MiB Range/Brotli/gzip response memory and content checks.

## Topic evidence

- architecture, server-internals: coordinator/client/node pipelines and Core routes.
- data-auth: stream completion, rollback and pending-upload quota reservations.
- protocol, shared: configurable file bound versus fixed part/batch/chat bounds.
- deploy: merged max-file configuration with direct and multipart setup.
- features/playwright-reader, projects: stale marker came solely from SISL-818
  adding optional MessageAttachment.thumbnailAvailable in shared/types.ts;
  browser and project behavior is unaffected by that optional attachment field.

## Validation

Passed:
- `npm run typecheck -w @voicechat/shared`
- `npm run test:files -- packages/shared/src/fileStorage.test.ts packages/file-storage/src/node/server.test.ts` (13 + 9 tests).
- `npm run test:files -- packages/file-storage/src/node/server.test.ts` (9 tests after final atomic stream-open adjustment).
- `npm run kb:index`
- `npm run kb:check -- --strict`

Unavailable in the prepared dependency installation:
- `npm run typecheck -w @sislexa/file-storage` and `npm run typecheck -w @voicechat/server`: TS2307, cannot find undici.
- `npm run gate:task -- --base 62e7641beb8be909c36bd1480298e194c3f28de5`: stops at storage typecheck for the same missing dependency.
- `npm run test:files -- packages/file-storage/src/client.test.ts packages/file-storage/src/service.test.ts apps/server/src/fileStorage/routes.test.ts apps/server/src/fileStorage/streaming.test.ts apps/server/src/fileStorage/chat.test.ts apps/server/src/fileStorage/uploads.test.ts apps/server/src/fileStorage/runtime.test.ts packages/file-storage/src/direct.test.ts`: client/service collection cannot load undici; direct test passes.
- `npm run test:files -- apps/server/src/fileStorage/routes.test.ts apps/server/src/fileStorage/streaming.test.ts apps/server/src/fileStorage/chat.test.ts apps/server/src/fileStorage/uploads.test.ts apps/server/src/fileStorage/runtime.test.ts`: all five suites cannot load undici.

The dependency and lockfile changes come from SISL-811. No dependency installation,
push, commit, deployment or persistent service was performed. Supervisor must
provide the merged dependencies and rerun the focused checks and task gate.

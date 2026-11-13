---
title: sm37-owner-kb-repair
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sm37-owner-kb-repair

## Changes

Reconciled architecture.md and shared.md with the storage title API in
0623c83e, then refreshed their checked markers using the KB CLI and regenerated
the index. The owner workflow failed its scoped strict KB check, not the
22-test task gate shown earlier in its output.

## Verification

Reviewed each topic's areas and the code diff since its previous checked SHA.
Architecture's net changes are the coordinator updateSpace method, its README
entry and fileStorage injection into embedded admin routes. Shared's only net
source change is UpdateStorageSpaceRequest. Reviewed the route, transactional
owner check and the rename regression assertions.

## Documentation

- docs/kb/architecture.md: coordinator rename semantics and admin wiring.
- docs/kb/shared.md: PATCH title request and unchanged space identity.

## Validation boundary

kb:check no longer lists architecture.md or shared.md. It lists only the same
17 pre-existing topics exempted by the supplied owner workflow. diff --check
passes. No runtime code or gate command changed; the workflow will rerun its
complete command after this repair.

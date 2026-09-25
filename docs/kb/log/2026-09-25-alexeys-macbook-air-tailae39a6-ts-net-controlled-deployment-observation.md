---
title: controlled-deployment-observation
date: 2026-09-25
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# controlled-deployment-observation

## Changes

Added optional idempotent operation IDs and exact commit enforcement to the
existing detached Core launcher. Durable JSON records distinguish launch from
verified completion and block retries after uncertain effects. Observation-only
reconciliation uses the same Core/UI lock and cannot resolve unknown Compose
completion. The legacy no-argument invocation remains supported.

## Evidence and knowledge

The initial Bash compatibility regression was fixed by keeping the detached
argument array nonempty on macOS Bash 3.2. Disposable fixture tests cover exact
commit success, changed request, moved HEAD, host-lock contention, wrong runtime,
recovery, unknown command completion and SIGKILL without a replacement deploy.
The complete `npm run gate` passed, selecting gate:all: typecheck, tooling and
workspace tests, published frontend validation and all browser integration batches
including Electron. All nine controlled-operation tests also passed on Linux with
disposable mocked Git/Docker commands. Missing SQLite and Electron install outputs
were prepared in the fresh checkout before the final successful gate. No production
release was launched.

## Documentation

Updated docs/kb/deploy.md and docs/delivery-release-adapter.md.

## Remaining commissioning

Delivery-control must install the reviewed owner launcher, preserve its own live
fencing and verify full composition/unaffected services around this operation.
Owner journal success alone does not accept B06, S0 or a production QA stage.

---
title: controlled-source-recovery
date: 2026-09-25
machine: alexeys-macbook-air-2
author: unknown
---

# controlled-source-recovery

## Changes

- Added the v2 protected source request path to the existing detached owner.
- Recorded pre-effect immutable source/composition evidence and durable command exits.
- Added exact recovery, lease/replay/unknown-child tests and Linux flock exclusion.

## Findings

- Legacy v1 records do not contain enough previous-artifact evidence for automatic recovery.
- Recovery needs the same operation identity and renewed live authority; a healthy probe cannot resolve unknown completion.

## Documentation

- docs/kb/deploy.md
- docs/delivery-release-adapter.md

## Validation and commissioning

- Shell/JavaScript syntax and Python/fixture AST checks passed. Process tests fail at `spawnSync` with sandbox `EPERM`, before fixture execution.
- `npm run gate:fast` and `npm run gate` were invoked but exited 255 in this sandbox; no passing gate is claimed. The supervisor must run the required gate and Linux process coverage.
- KB commands were invoked; npm child spawning failed, so the underlying Node log/index commands were run directly. KB touch could not read Git through its subprocess; the checked SHA uses the separately observed baseline HEAD. The generated index falsely marked all topics fresh because Git subprocesses were denied, so that output was discarded and the committed generated index restored. The supervisor must regenerate the index with working Git access.
- The operator must install the adjacent trusted helper, validate immutable recovery artifacts, commission broker/verifier integration and publish only after review. No production access, commit or push occurred.

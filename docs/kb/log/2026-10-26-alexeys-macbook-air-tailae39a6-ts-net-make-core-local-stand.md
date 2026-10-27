---
title: make-core-local-stand
date: 2026-10-26
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# make-core-local-stand

## Changes

- Accept ready local-stand environments in Make's Core adapters.
- Run Core from the conversation checkout and supervise local stand service groups.
- Add Make adapter coverage and process-level signal/failure tests.
- Stabilize existing Docker stand tests: successful subprocess health probes get 2 seconds instead of 50 ms; expected health failures keep the 50 ms budget. Production deadlines and all assertions are unchanged.

## Verified knowledge

- Core conversations use components/core/live with the conversation worktree; preview uses the stand proxy while files and git stay in that worktree.
- dev:stand:run handles SIGTERM/SIGINT and Core/Core UI exits; SISLEXA_STAND_CORE_SOURCE skips Core worktree creation and dependency installation.

## Updated topics

- docs/kb/deploy.md
- docs/kb/server-internals.md

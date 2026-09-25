---
title: source-runtime-installation
date: 2026-09-25
machine: alexeys-macbook-air-2
author: unknown
---

# source-runtime-installation

## Implementation

The installed Core wrapper now freezes deploy.sh and optional source-recovery.py
into one content-addressed runtime before execution/detachment. A small Python
publisher provides private verified copies, atomic publication and validated
concurrent replay. Corrupt, symlinked or partial runtimes fail without repair.
The existing Core/UI host lock, argv, metadata and legacy helper absence remain
unchanged. Required-companion callers explicitly set VC_SOURCE_RECOVERY_REQUIRED=1.

## Evidence

All 17 isolated actual-process installation tests passed on macOS, including
concurrent creation/replay and detached stability across source changes. Full
workspace typecheck, Bash/Node/Python syntax checks and git diff --check passed.
The filesystem smoke also passed legacy/replay, required absence, pair identity
and tamper rejection. Tests use generated wrappers and harmless fixtures only.

The default worker PATH includes inaccessible search entries; selecting only
system executable directories allows these subprocess checks without changing
sandbox permissions. The gate planner retains its full-gate selection for the
package.json tooling-test wiring. Full gate evidence remains subject to sandbox
limitations and supervisor Linux verification.

`npm run gate` selected gate:all and exited 1 in existing browser UI tooling
tests: loopback listen and home-directory fixture creation returned EPERM.
The first tooling group reported 64 passed / 13 failed (including the parent
subtest failure); workspace tests/build were not reached. The final retry used
the assigned attempt TMPDIR; its output is in the attempt artifact
`b01-gate.log`. KB touch and generated index completed with the system PATH.

## Documentation

- docs/source-runtime-installation.md
- docs/kb/deploy.md

## Remaining boundary

This is partial B06 implementation work, not stage acceptance. No recovery
implementation or owner protocol was changed. Supervisor full gate/combined
Linux tests and subsequent operator commissioning remain separate. No production
installer, service, credentials, data, commit or push was used.

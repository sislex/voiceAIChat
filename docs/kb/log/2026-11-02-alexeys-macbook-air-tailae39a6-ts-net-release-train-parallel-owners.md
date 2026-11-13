---
title: release-train-parallel-owners
date: 2026-11-02
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# release-train-parallel-owners

## Changes

- Owner repositories now release concurrently through asynchronous child commands.
- Per-owner checkpoints preserve completed work, migrate legacy pending steps and
  drain in-flight operations before unlocking a failed journal.
- All verified owners feed the existing single Core pin, gate and promotion sequence.
- Desktop is explicitly excluded, including resumed journals.

## Evidence and documentation

- Reviewed `scripts/release-train-run.mjs` and the concrete adapter tests in
  `scripts/release-train-run.test.mjs`; documented the behavior in `docs/kb/deploy.md`.
- Added local Git integration tests for two owners, combined pins and failure/resume;
  child-process overlap and legacy checkpoint/drain behavior have focused tests.
- Required validation: `npm run gate:task -- --base f89e2e742b5d794b38d2ed1dd3d3c511beb7f534`.
- Script typecheck: `node_modules/.bin/tsc --noEmit --allowJs --checkJs --allowImportingTsExtensions --target es2022 --module nodenext --skipLibCheck scripts/release-train-run.mjs`.

## Operational scope

No real releases, deployment, commits or pushes were performed. External GitHub fetch
was denied by the sandbox; integration fixtures use disposable local repositories.

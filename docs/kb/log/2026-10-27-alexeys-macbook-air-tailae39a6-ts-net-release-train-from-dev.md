---
title: release-train-from-dev
date: 2026-10-27
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-train-from-dev

## Changes

- Added release-train plan/run --from-dev with persisted resume mode, owner quick-gate selection, dev pushes and Core fast release branch requests.
- Added fixture coverage for gate fallback, concurrent pushes, resume, API compatibility failures and unchanged main branches.

## Verified behavior

- Owners publish the gated dev SHA; Core requests baseBranch dev and fast true without creating main PRs.
- A rejected fast request or missing fast confirmation stops the train; it does not fall back to a full release.

## Documentation

- docs/kb/deploy.md — Release train execution (C01).

## Validation

- All 54 release-train fixture tests passed.
- gate:fast selected the full fallback. Typecheck, tooling, all workspace tests and frontend checks passed on retry; browser integration reported a failure in the unchanged universalSearch suite.
- session.test.ts passed all 31 cases when rerun after its earlier timeout. universalSearch passed on clean origin/dev and again after restoring the task changes. The full gate is not reported as successful.

## Follow-up

- Operator commissioning and the first real fast deployment validate the independent Release Center implementation.

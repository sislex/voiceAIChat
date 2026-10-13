---
title: full-gate-failed-test-reports
date: 2026-10-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# full-gate-failed-test-reports

## Changes

- Added isolated tooling/workspace/browser test reports to the full gate and the final stage/file failure markers. Added fake-runner tests for aggregation, cleanup, exit status and output format.

## Findings

- Tooling chains multiple node:test commands, including a prefixed package; each invocation needs a separate report. Workspace and browser runners need explicit Vitest JSON reporter options.

## Documentation

- docs/kb/testing-operations.md

## Validation limits

- The required task gate needs supervisor execution: npm exits 255 in the sandbox; direct execution reports `spawnSync git EPERM`. Focused tests and JavaScript typechecking can run directly. KB commands were run directly after npm wrappers failed; the checked SHA was restored from `git rev-parse HEAD` because the KB subprocess could not read Git.
- The affected-test planner selected full-gate, browser-gate, test-files, affected-check and application-gate tests. The combined run passed 82/110; 28 existing affected-check cases failed while launching Git/shell fixtures (null status or missing fixture output). Regenerating the KB index also lost Git-derived freshness data under sandbox restrictions, so its generated changes were discarded; the supervisor should regenerate it.

---
title: Isolate native Core test fixtures
date: 2026-09-25
machine: alexeys-macbook-air-2
author: unknown
---

# Isolate native Core test fixtures

## Changes

- Added private data directories and ordered teardown for STT, TTS, project and
  published Runner contract fixtures. Added a targeted config adapter for legacy
  session, account-access and Runner-proxy fixtures without editing those suites
  or changing production defaults.
- Cleanup traversal now uses search-only ancestor handles while preserving
  descriptor-relative operations, no-follow checks and resource identity checks.
- Automated QA assertions wait for persisted completion; project WS clients are
  terminated during teardown even when assertions fail.

## Findings

- An in-memory Core database does not prevent startup writes by preview
  reconciliation. A partial config object still needs an explicit `VC_DATA_DIR`.
- macOS Python exposes `O_SEARCH`; Linux provides `O_PATH`. These permit ancestor
  lookup without requesting directory enumeration rights from the sandbox.
- QA startup invalidation can precede the normalized result of the background
  workspace failure. An open test WS can then obscure an assertion failure with
  a teardown timeout.

## Documentation

- docs/kb/testing-operations.md#isolated-native-core-fixtures

## Verification and remaining acceptance

- At baseline `fca3a356`, the focused native run passed all 85 tests in cleanup
  (20, including negative and race checks), projects REST (64), and private
  preview reconciliation (1). The config adapter regression passed both tests;
  account-access passed 13 tests and its two loopback cases failed with sandbox
  `listen EPERM`. No unhandled errors appeared in these focused runs.
- After adding the delayed-persistence QA regression, all 68 tests in projects
  REST and the two fixture regression files passed. Cleanup's 20 tests passed in
  both the focused run and the planner-selected run. Final server typecheck and
  `git diff --check` passed.
- `npm run gate` selected the complete server typecheck and test suite. The
  first sandbox run exited 1 after 858 seconds, including loopback failures and
  consequent timeouts. The later run with the legacy config adapter passed
  typecheck; it was interrupted (exit 130) after the same network failures,
  rather than repeating the remaining 60-second socket timeouts. Its Runner
  contracts reached `listen EPERM`, with no RunReceipts path error. Artifacts
  are `b01-focused.log`, `b01-fixtures.log`, `b01-regressions.log` and
  `b01-gate.log` under the assigned attempt's artifacts directory.
- The complete planner-selected server gate is required. Model-sandbox network
  failures do not establish native owner acceptance. The supervisor must review
  and run the combined native and Linux gates, including all four real published
  Runner HTTP contracts and the Automated QA WS case.
- Known tooling browser/fence fixture paths and the installer assertion belong
  to separate operator work. No installer, source-runtime/recovery, release
  adapter, dependency or lockfile edits are part of this patch. This is partial
  B06 prerequisite work, not deployment or stage acceptance.

---
title: public-chat-text-only-machine-policy
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-text-only-machine-policy

## Changes

- The server-configured text-only policy bypasses machine resolution and Git
  preflight before model execution. It supplies no remote transport and retains
  explicit execution-disabled plan permissions for every role.
- Saved machine preferences are preserved. Ordinary deployments still enforce
  their machine warnings, offline denial and project preflight failures.

## Evidence and findings

- Required quick gate `npm run gate:quick -- --base
  22efc2c227279ec999e096ed53237acfa479b118` passed with exit code 0: server and
  knowledge typecheck/build, 55 related test files / 565 tests, followed by the
  changed-file rerun of all eight new regression tests.
- The first gate attempt exited 1 after an existing voice-configuration cleanup
  hook timed out at 60 seconds (missing STT model case); 564 other tests passed.
  The required failed-file rerun of `system/voiceConfiguration.test.ts` passed
  5/5 with exit code 0 without any code changes, and the complete quick gate
  then passed as reported above. Local logs are
  `/private/tmp/sislexa-text-only-machine-gate.log`,
  `/private/tmp/sislexa-text-only-machine-rerun-voice.log` and
  `/private/tmp/sislexa-text-only-machine-gate-rerun.log`.
- The real public non-admin warning came from the main turn before `claude.start`,
  not a later auxiliary command. Execution continued while the UI retained the
  preliminary `claude.error`.
- Regression tests first reproduced four failures: non-admin warning, missing
  admin execution-disabled policy, stale offline target and unwanted Git preflight.
- After the fix, all eight focused cases passed, including ordinary-mode control
  cases and forged per-request flags that cannot enable the server policy.
- Independent read-only review found no blockers in the trusted policy boundary,
  saved preference handling, ordinary-mode checks or unchanged Billing admission.

## Knowledge base

- `docs/kb/deploy.md`

## Acceptance boundary

- Tests use the real turn manager and in-memory data with synthetic model
  transports. No paid calls, stand mutation or ledger edits were performed.

---
title: Autonomous task delivery and per-task manual QA pause
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Autonomous task delivery and per-task manual QA pause

## Changes

- Added task settings for autopilot and manual QA pauses; migration preserves the previous project preference.
- Wake the next stage after QA skips, isolate individual task failures, delay QA retries, and allow an initial preparation/merge attempt when the retry limit is zero.
- Persist QA diagnostics before enqueueing the fix run and include them in the first model request. Diagnostic bug cards do not start a second development pipeline.
- Integration Tests accepts implementation files alongside tests and requires explicit markers for every mandatory automated case.

## Findings

- Rejecting implementation files in the entire feature diff made ordinary features impossible to deliver through Integration Tests.
- QA completion callbacks were not awaited before the final board event.
- One task failure could abort the project tick; skipped QA stages did not wake their successors.

## Knowledge base

- docs/kb/features/task-autopilot.md
- docs/kb/features/qa-stage-runs.md
- docs/kb/testing-operations.md

## Remaining verification

- Live task creation and end-to-end browser verification are blocked by the in-app Browser error `missing field sandboxPolicy`.
- Focused tests cover settings, migration, diagnostics and QA transitions. `npm run gate:fast` and `npm run gate` both passed with exit code 0. Gates need unrestricted filesystem access because older server tests write to `~/.voicechat-server`. The standalone login app required its separate `npm ci --prefix apps/login-application` installation before typecheck could pass.
- The extra `npm run e2e:projects` run failed: its fixture has no online companion, so project creation opens the device connection dialog. DOM inspection confirmed this prerequisite; subsequent missing-project failures cascade from it. No production task or release was created by this suite.

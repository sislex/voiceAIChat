---
title: final-owner-test-migration
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# final-owner-test-migration

## Changes

- Identity PRs #12/#13 own 29 auth/device cases, two session UI browser cases and
  the plain login accessibility assertion. Their owner gates pass independently.
- Playwright Reader PRs #9/#10 own four address normalization and eight BrowserInput
  DOM cases. PR #9 also corrects the canonical frame-path re-export caught by Core.
- UI PR #6 owns eight accessibility-helper cases. All migrated Core copies removed.
- Core retains orchestration, account/resource isolation and WebSocket integration.
- Scheduling audit reconnects four retained host suites. Electron's platform path
  is fixed; real Voice/LLM QA has an explicit command instead of implicit dependencies.

## Evidence

- Core fast gate #4: exit 0, 108 browser cases.
- Expanded gate #5: 125/127 passed; Electron path/live-service setup failures.
- Corrected settings suite: 5/5 Chromium/Electron cases passed.
- Final canonical Core gates and production cutover remain pending.

## Knowledge

- `docs/kb/testing-operations.md`: test ownership, scheduling, live voice prerequisites.
- `docs/plans/extraction-completion.md`: remaining runner extraction and rollout.

## Final consumer cleanup

Image Studio 1.1.2 (PR #36) owns retouch processing/editor and eight cases.
Identity 1.3.1 (PRs #14/#15) owns twelve session-store and fifteen account-page
cases. The latter exposed and fixed standalone account tab loading without Core's
cache; two owner regressions cover its independent cache. LLM Runner 0.3.1
(PRs #9/#10) owns CLI/history regressions and publishes clean consumer archives.
Core removes its actual runner workspace, implicit spawning/profile creation and
three duplicate TTS player cases. Its six account-cache/readiness cases, TTS
performance bridge and remote transport/resource checks remain.

Core gate #9 failed only the route-resource fixture, which had no configured MCP
provider and therefore retried the new unavailable response. Configuring its
HTTP provider preserves the original no-extra-warm-requests assertion; the
focused browser suite now passes (3 cases, 2 explicit baseline-only skips).
Canonical final gates and production rollout remain pending.

The final Shared audit removes 24 persisted-CLI parser cases and their unused
implementations from Core. The original files match Runner's contract tests
verbatim; Core retains five conversation-resume mapping cases using runner DTOs.
Two account-store lifecycle cases move from Core's mixed database suite to
Identity's store suite; cross-domain deletion remains a Core integration check.

## Final gate result

Both canonical Core gates exited 0; each completed all 126 host browser cases.
Identity PR #16 and its main CI passed. All 31 retired source directories are
absent from both the filesystem and lockfile. All 16 owner-manifest archives
pass source SHA, integrity and internal-test exclusion checks. The planned
production cutover is 0.1.323; rollout acceptance remains a separate final step.

---
title: chat-474-onboarding-qa
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-474-onboarding-qa

## Changes

Removed conflicting instructions to append a kb-gaps block outside the single
DevelopmentReadiness JSON object. Clarified that a question is an intermediate
clarification, never a completed brief, and is not a valid recovery result.
Retained existing strict parsing, runtime schema and safe normalization.
Added regression coverage and the required case markers; strengthened keyboard
exit and recovery assertions without changing onboarding product behavior.

## Evidence and historical limits

Base revision: `9336bc5d290256615b97a567531f26a35202c612`.
Branch: `CHAT-474`. Machine: `MacBook`.

The current project configuration returned by `mcp__kb__projects` specifies
`automatedQaCommand: npm test`. The original run's full log and original command
snapshot were not recovered. Its successful 31-file/483-test excerpt cannot
establish the first failure or the final command result.

Commit `911e2eb0894fc9b57bcfd9e8f3c1d895be7ca78e` is an ancestor of the base revision.
Its diff distinguishes obsolete cache reads from transport AbortError and filters
AccountPage cache invalidations by resource family. Neither that diff nor the
preparation prompt defect proves the cause of the historical QA failure.

The development-stage instruction explicitly forbids raw `npm test`; therefore
full Automated QA must run in the subsequent workflow stage. No claim of full
Automated QA success or non-reproduction is made here. The TC-QA-1 runner regression
uses an injected executor to check command forwarding, output collection and
final exit status; it does not replace the real workflow run.

## Verification

- Targeted server suites: 118 tests passed, exit 0.
- `npm run -w @voicechat/ui test -- src/components/SettingsModal.dom.test.tsx`: 46 tests passed, exit 0.
- `npm run -w @voicechat/web build`: exit 0.
- `npm run e2e:settings -- -t 'keeps onboarding navigation and actions reachable across themes, touch and keyboard'`: exit 0. Chromium covered light/dark themes, 1440×900, 1280×720, 768×1024, 390×844 and 320×700, touch, keyboard and reduced mobile viewport height.
- Full logs and selected screenshots are preserved in `artifacts/CHAT-474/`.
- `npm run gate:fast`: exit 0, 2026-09-15 19:44:43–19:51:41 UTC. Server: 2,284 passed / 43 existing skips; UI: 3,268 passed / 2 existing skips; web: 2 passed. All selected type checks, server build, Storybook and web build passed. Full stdout/stderr: `artifacts/CHAT-474/gate-fast.log`; command and exit metadata: `artifacts/CHAT-474/gate-fast.status.json`. The checked source changes are included in this commit; subsequent edits only record these results.

## Knowledge base

Updated the existing `features/task-preparation.md` readiness section.
The project-owned onboarding article is updated through the workflow kb-gaps handoff.

---
title: chat-475-queued-merge-machine
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-475-queued-merge-machine

## Changes

Added queued merge reassignment with a persisted assignment revision, conditional
claim/cancel operations, transactional audit and access/readiness revalidation.
Both merge surfaces share the selector and apply structured conflicts without
cancel/retry. Merge snapshots now reach active project members. Desktop uses the
same REST bridge as web.

Strengthened the Development Brief prompt's ban on progress messages and its
normalization boundary, retaining the existing strict parser/schema. Added
marked regression, transport, concurrency, persistence and UI coverage.

## Verified findings

Merge uses a process-wide slot and delayed callbacks, not the CI FIFO. Execution
must claim the persisted queued row before capturing its machine. The old
snapshot publisher delivered only to the initiating user. Assignment versioning
also prevents an old HTTP/WS response from overwriting a newer UI assignment.

## Documentation

- docs/kb/features/merge-runner.md
- docs/kb/features/task-preparation.md

## Validation

Focused merge tests: 81 passed; the additional real autopilot overlap test passed.
Preparation pipeline tests: 94 passed. Both UI surfaces and the REST bridge:
20 DOM/transport tests passed, including a delayed response after a newer snapshot.
Selected browser E2E: 4 files / 21 tests passed, including Component QA for
both surfaces × five viewports × two themes.
The headless browser checks keyboard focus/submission and touch; native popup
selection uses selectOption, and a reduced viewport represents keyboard space.
Screenshots and gate output are in ignored .generated_images.
The first gate found two DB architecture violations, fixed and rechecked.
The next gate reached missing isolated Electron dependencies; restored desktop,
agent-tray and login dependencies as documented, without changing manifests.
Final `npm run gate:fast`: PASSED (exit 0). The gate completed shared/server/UI
checks, Storybook and web builds, the isolated Electron application checks/builds,
affected applications/contracts and all 21 selected E2E tests. Server: 2338 tests
passed; UI: 3305 tests passed, with existing skips retained.
Full affected-check/gate and raw root npm test were not invoked.
Manual QA is intentionally skipped. Commit remains on CHAT-475 without push;
workflow owns subsequent merge and production checks.

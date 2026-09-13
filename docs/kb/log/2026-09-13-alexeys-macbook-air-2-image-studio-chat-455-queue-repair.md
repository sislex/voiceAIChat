---
title: image-studio-chat-455-queue-repair
date: 2026-09-13
machine: alexeys-macbook-air-2
author: voicechat-ci
---

# image-studio-chat-455-queue-repair

## Changes

Moved queue admission after asynchronous source checks so concurrent edit
requests use a current count and reserve capacity without yielding. Rechecked
shutdown at the same boundary. Rejected malformed task parameter objects and
non-boolean noText values without coercion.

## Reproduction and regression coverage

Seven new regression cases failed before the fix: 51 synchronized edit
submissions were all admitted despite the limit of 50, and six malformed
parameter inputs received HTTP 202 instead of 400. All seven passed after the
fix. Two additional cases verify that valid true/false values reach prompt
instructions and saved metadata correctly. Tests carry TC04, TC05, and TC09
markers; the original TC01–TC09 coverage remains in the branch.

## Validation

All required commands returned exit code 0:

- `npm run gate:app -- image-studio`: 63 application tests and 20 bridge checks.
- `npm run gate:app -- image-studio-ui`: 338 package tests, four host checks,
  production builds, and 13 browser checks including 390px layout, 500-image
  windowing, and real canvas versions.
- `npm run gate:fast`: selected image-studio from the repair worktree diff and
  passed its typecheck, all 63 tests, and build check.

The original TC01–TC09 marker coverage and stories were retained. This repair
does not claim a new structured Component QA or Automated QA workflow verdict.

## Documentation

- docs/kb/server-internals.md
- docs/kb/ui.md

## Diagnostic limit

The supplied Automated QA excerpt contains only passing output. Targeted
checks in the preceding diagnostic pass were green, including both application
gates, host/shared suites, and 15 ZIP cancellation repetitions. The defects
above were reproduced directly; the missing original failure section prevents
attributing that specific QA run to them. No production deployment or push.

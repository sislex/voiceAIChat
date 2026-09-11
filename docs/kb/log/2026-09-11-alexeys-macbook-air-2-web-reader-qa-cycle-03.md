---
title: web-reader-qa-cycle-03
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 03: typography diagnostics

## Implementation

- Added 30 typography/text checks on both Reader surfaces, bounded text/font
  scans, explicit incomplete reports and caches that reset between audit calls.
- Moved browser examples to a test-only fixture export and one shared registry.
- Registered audit source paths with the application gate so future group changes
  select both Reader browser suites automatically; added a planner regression.

## Verification

- Focused tests: 201 proxy browser tests, 187 native browser tests, 14 gate planner
  tests and 9 browser-contract tests passed. Targeted typechecks passed.
- Four initial native Unicode failures exposed a missing charset in the fixture
  response. Declaring UTF-8 fixed decoding and all cases then passed. The runtime
  checks correctly observed the incorrectly decoded document.
- Inspected `/private/tmp/web-reader-qa-cycle-03/cycle-03-typography.png`.
- The first gate was intentionally stopped with SIGTERM (143) after a separate
  browser probe found quoted commas being mistaken for generic font fallbacks.
  Quote-aware parsing and regressions were added before restarting the gates.
- Frozen implementation: `gate:fast` passed in 476.82 s and pre-commit `gate`
  passed in 496.25 s, both exit 0. Each browser stage passed 455 tests in 27 files.
  Run: `20260910235529807-f48235dd-d759-46dd-87fa-2eab0c474edb`.
- Native public typography probes passed on Google, Facebook and Instagram:
  6.1/12.6/10.6 ms, 474/693/725 scanned elements, 0/2/2 candidates respectively.
  Inspected screenshots under `/private/tmp/web-reader-native-audit-cycle-03/`;
  consent dialogs remained open and no credentials were entered. Meta findings
  were font-fallback review candidates, not confirmed defects.

## Knowledge base

- `docs/kb/ui.md`, audit groups, bounds, fixtures and browser gate selection.
- `packages/browser-contracts/AGENTS.md`, production/fixture entry points.
- `docs/kb/testing-operations.md`, raw long-run status versus CLI classification.

## Remaining work

- Cycles 04-30 are unimplemented.
- The color prototype under `/private/tmp/web-reader-cycle-04-preparation/` is
  preparation only and has not been counted as a product improvement.
- A separate native AX probe found that CSS-generated button text is absent from
  the reader naming helper. Cycle 08 must calibrate naming checks against browser
  accessibility snapshots; this existing limitation is now recorded in UI KB.

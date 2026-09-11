---
title: web-reader-qa-cycle-06
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 06: forms and validation

## Implementation

- Added 30 dynamically discovered `forms` checks on both Reader surfaces: ten
  native validity states and twenty configuration/state/ownership diagnostics.
- Native states are informational; ARIA mismatches and configuration candidates
  require application-specific review. No validation methods, invalid events,
  live value reads or custom error-message reads are needed.
- Added native metadata parsing, periodic time-range handling, Unicode-sets pattern
  parsing, bounds, shared user-edit fixture preparation and supplementary cases.

## Verification

- 419 proxy Chromium diagnostics passed in 27.94 s; 392 native diagnostics passed
  in 5.90 s. The shared browser-contract suite passed all ten tests and both
  package typechecks passed.
- The first native run exposed test-harness assumptions: input returns session
  metadata, and arbitrary verification evaluate calls must use the user actor
  while human control is active. Corrected the harness and reran successfully.
- Tests cover both states of all 30 checks, parser edge cases, user-edit-only
  validity behavior, password getters that throw if read, no invalid events or
  mutations, preserved focus/selection/scroll, human ownership and live repairs.
- Inspected `/private/tmp/web-reader-qa-cycle-06/cycle-06-forms.png`. The initial
  screenshot clipped the repaired example below the iframe; tightened fixture
  spacing, reran its browser test and inspected all three visible examples.
- Native public forms audits completed on Google/Facebook/Instagram in
  1.2/1.6/1.6 ms without truncation or findings. This describes their initial
  consent/login documents only; it does not verify custom validation or sign-in.
- `gate:fast` passed in 160.03 s with 464 browser tests; pre-commit `gate`
  passed in 522.63 s with 675 browser tests in 27 files. Both exited 0 with
  implementation frozen. Persisted run: `20260911012344274-bad33b07-0694-45af-8dd7-15d720f856fb`.

## Knowledge base

- `docs/kb/ui.md`: forms semantics, privacy, parser bounds and fixture behavior.
- `packages/browser-contracts/AGENTS.md`: shared real-keyboard fixture preparation.

## Remaining work

- Cycle 06 is complete in this commit. Cycles 07-30 remain unimplemented;
  the cycle 07 focus prototype is preparation only.
- Signed-in external scenarios still await a user-selected test profile.

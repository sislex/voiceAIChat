---
title: web-reader-qa-cycle-02
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 02: layout and native audits

## Implementation

- Added 30 layout checks and shared trusted audit program generators between
  proxy Reader and native Chromium. Native parity is supporting infrastructure,
  not counted as another set of 30 improvements.
- Native audits preserve human ownership and last actor, return original logical
  URLs, and reject unsupported old runners explicitly. Arbitrary evaluate code
  remains on its existing policy path.
- Fixed finding selectors for duplicate sibling IDs.

## Verification

- Focused checks: 132 proxy Chromium tests, 125 native-runner tests, 70 shared
  contract/mapping tests, 9 browser-contract tests and 8 Reader module tests passed.
- The full App/MCP/runner audit test passed after waiting for the asynchronous
  ownership request to finish; the initial assertion ran before UI acknowledgement.
- Inspected `/private/tmp/web-reader-qa-cycle-02/cycle-02-layout.png`.
- Public native audits succeeded on Google, Facebook and Instagram after their
  search/login controls appeared. Markup/layout scans respectively took 3.4/5.9 ms,
  5.6/18.6 ms and 4.5/12.9 ms over 476, 691 and 717 elements. These are single
  observations, not a performance guarantee. Findings are diagnostic candidates,
  not a verified bug count for those sites. No login or consent action was attempted.
  Artifacts: `/private/tmp/web-reader-native-audit-cycle-02/`.
- `npm run gate:fast` passed with exit code 0 in 910.58 s, including all 371
  Reader E2E tests across 24 files. Pre-commit `npm run gate` passed with exit code
  0 in 528.68 s, again with all 371 E2E tests passing.
- The queued launcher misread the long-run helper's raw `finished` status as a
  failure and did not start the pre-commit command. It was started directly after
  confirming the successful development gate; no product tests failed in that run.

## Knowledge base

- `docs/kb/ui.md`, Model-facing Web Reader audits.
- `packages/browser-contracts/AGENTS.md`, shared pure audit generators.
- `docs/plans/web-reader-model-qa-30-cycles.md`, cycle checklist and progress.

## Remaining work

- Cycles 03-30 remain unimplemented. Typography and color prototypes outside the
  repository are preparation only; they have not been counted as product changes.

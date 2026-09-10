---
title: Web Reader QA cycle 01 - evidence-based markup audit
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 01 - evidence-based markup audit

## Implementation

- Added the bounded `audit` action and MCP tool with 30 markup checks, rule
  discovery, scoped execution, pagination, evidence and explicit coverage limits.
- Added paired broken/repaired Chromium fixtures for every check, report-boundary
  tests and MCP/contract tests. Recorded the requested 30-cycle backlog separately
  from implemented work in `docs/plans/web-reader-model-qa-30-cycles.md`.
- Preserved the previous timing notes. Installed the three Electron applications'
  separate dependencies because the shared-contract change selects them for checks.

## Findings and verification

- Focused tests: 49 shared contract tests, 118 MCP tests and 70 Chromium audit tests
  passed. Screenshot `/private/tmp/web-reader-qa-cycle-01/cycle-01-markup.png`
  was visually inspected. The final `npm run gate` passed with exit code 0 in
  743.57 s, including all 279 Reader E2E tests. The earlier fast gate overlapped a
  late runtime/test change and failed; the frozen-implementation full rerun passed.
- A real public-page proxy probe rendered Google's consent dialog and Facebook's
  error page. Instagram initially showed a branded loading screen with no extracted
  text; waiting for actual controls exposed a page-unavailable message and cookie
  consent. No JavaScript exceptions were reported by these probes. Bridge readiness
  and a clean console do not establish application readiness or successful loading.
  These observations do not establish authenticated compatibility.
- In-app browser initialization fails before execution because sandbox metadata is
  unavailable. The existing repository Chromium harness provided browser verification.
- Public-site screenshots and probe JSON: `/private/tmp/web-reader-public-baseline/`.
- The native `BrowserSessionManager` probe rendered Google consent and Facebook/
  Instagram login forms behind cookie dialogs. Screenshots were inspected. Meta
  logged Credential Management service errors; neither login nor consent was
  attempted. Artifacts: `/private/tmp/web-reader-native-public-baseline/`.

## Knowledge base

- `docs/kb/ui.md`, model-facing Web Reader audits.
- `docs/plans/web-reader-model-qa-30-cycles.md`, scope, baseline and cycle checklist.

## Remaining work

- Cycles 02-30 remain unimplemented. The next cycle adds native audit parity and
  layout diagnostics; the existing full Chromium engine preserves browser origin.
- Authenticated external scenarios and diagnostics beyond markup remain on the backlog.

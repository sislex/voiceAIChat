---
title: web-reader-qa-cycle-05
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 05: control-state probe

## Implementation

- Added `probe {selector}` on both Reader surfaces with 30 condition/comparison
  pairs. The bounded shared result separates rendering, pointer samples, native
  and declared state, editable properties, source selectors and incomplete coverage.
- Added MCP and runner validation, native read-only ownership handling and a
  reusable native DOM prelude. Malformed or missing reports fail explicitly.
- Corrected semantic visibility for CSS overrides of hidden attributes and hidden
  ancestors. The action history displays readable inspection labels.
- Nested disabled fieldsets report the ancestor that actually disables the target.

## Verification

- Shared contract/mapping tests (40), MCP tests (121), module tests (9) and
  browser-contract tests (10) passed. The original 30 condition/comparison pairs
  passed on both engines before adding supplementary limits/privacy regressions.
- Full native App/MCP probe test passed with a password field and human ownership.
- The first full proxy App test timed out because recorder and host bundles were
  stale. `build:frontends` builds panels only. Rebuilding recorder and web host
  made the full proxy App/relay/WebSocket test pass with input and DOM preserved.
- Inspected `/private/tmp/web-reader-qa-cycle-05/cycle-05-probe.png` showing the
  intercepted button and a separate reachable control.
- Final focused regressions passed: 340 proxy diagnostics, 11 full proxy App
  tests and 314 native diagnostics, including stale-reference rejection. The
  repository typecheck and panel/recorder/web builds passed.
- `gate:fast` passed in 592.30 s (587 browser tests); pre-commit `gate` passed
  in 616.81 s (596 browser tests in 27 files). Both exited 0 with implementation
  frozen throughout. Persisted run: `20260911005524166-e1460584-666b-431d-a965-b21d3639bdda`.
- Native public probes on Google/Facebook/Instagram completed in 0.7/1.2/0.9 ms.
  Each target was browser-visible but pointer-blocked by consent content. Inspected
  all three screenshots. No credentials, login or consent choice were used.

## Knowledge base

- `docs/kb/ui.md`: probe behavior, bounds, unknown states and visibility semantics.
- `docs/kb/testing-operations.md`: required builds before focused full-App tests.
- `packages/browser-contracts/AGENTS.md`: shared diagnostics and fixture boundaries.

## Remaining work

- Cycle 05 is complete in this commit. Cycles 06-30 remain unimplemented; the
  cycle 06 forms prototype is preparation only.
- Signed-in external testing awaits a user-provided test profile; public page
  inspection and local fixtures continue independently.

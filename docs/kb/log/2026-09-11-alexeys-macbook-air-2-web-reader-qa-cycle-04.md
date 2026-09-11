---
title: web-reader-qa-cycle-04
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 04: color and paint evidence

## Implementation

- Added 30 independently tested color/paint capabilities across nine report types
  on both Reader surfaces. The plan lists capabilities separately from rule IDs.
- Added bounded paint composition, modern CSS color conversion, explicit unknown
  paint reports and per-audit caches. Reports disclose precision and coverage.

## Verification

- 270 proxy Chromium tests and 249 native Chromium tests passed, including 60
  broken/repaired color cases on each engine. Nine browser-contract tests and
  both package typechecks passed.
- Supporting regressions cover live styles, generated-text uncertainty, selection
  opacity, SVG cache isolation, limits, sensitive-value exclusion and preservation
  of DOM/focus/selection/scroll. Native observation preserves human ownership.
- Inspected `/private/tmp/web-reader-qa-cycle-04/cycle-04-color.png`.
- During preparation, an image fixture used invalid CSS URL spacing. Encoding
  the space made the intended image backdrop real; all prototype cases passed.
- Public native color audits completed on Google/Facebook/Instagram in
  7.9/22.9/17.9 ms, scanning 476/693/725 elements without truncation. The
  27/19/28 returned candidates include paint-uncertainty observations and do not
  establish confirmed site bugs. No login or consent action was taken.
- Frozen implementation: `gate:fast` passed in 143.21 s and pre-commit `gate`
  passed in 510.51 s, both exit 0. The final browser stage passed 524 tests in
  27 files. Run: `20260911001521681-e992291d-3a3c-49be-aa44-49972e73133d`.

## Knowledge base

- `docs/kb/ui.md`: color capabilities, approximations, incomplete paint and bounds.
- `docs/plans/web-reader-model-qa-30-cycles.md`: the exact 30-capability checklist.

## Remaining work

- Cycles 05-30 remain unimplemented. A 30-case control-probe prototype under
  `/private/tmp/web-reader-cycle-05-preparation/` is preparation only.

---
title: web-reader-qa-cycle-07
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Web Reader QA cycle 07: focus and keyboard diagnostics

## Implementation

- Added a shared `focus` audit group: 26 report types cover 30 verified capabilities
  for autofocus, keyboard hints/shortcuts, focus paint/geometry, visual order and
  active-descendant relationships. All reports identify heuristic candidates.
- Included native modal and inert behavior, independent/pending autofocus scopes,
  Unicode accesskey tokens, actual reflected tabindex, retained inactive-frame
  focus, explicit limits and exclusions for radio traversal/modern reading flow.
- Auditing does not focus, press keys, read live values or inspect caret selection.

## Verification

- 511 proxy Chromium diagnostics passed in 37.60 s; 482 native diagnostics passed
  in 9.09 s. Both package typechecks and all ten browser-contract tests passed.
- Paired fixtures cover all 30 capabilities; additional cases cover valid browser
  behavior, native modal scope, password getter exclusion, unchanged DOM/focus/
  selection/scroll and human ownership. Real Tab/Shift+Tab checks validate the
  ordering fixture, and a live repair clears the same report.
- Inspected `cycle-07-focus-before.png` and `cycle-07-focus-after.png` in
  `/private/tmp/web-reader-qa-cycle-07/`: the focused field gains an outline and
  reversed buttons return to the tested keyboard sequence. Caret color itself is
  asserted from browser styles; screenshots can hide the blinking caret.
- Native public focus audits on Google/Facebook/Instagram took 3.6/4.5/5.2 ms,
  returning 3/1/2 heuristic candidates without truncation. These initial-page
  observations are not confirmed site bugs or signed-in compatibility results.
- `gate:fast` passed in 168.11 s; pre-commit `gate` passed in 548.33 s
  with 767 browser tests in 27 files. Both exited 0 with implementation frozen.
  Persisted run: `20260911014209063-8d250a4f-3dce-453e-8982-46c9a58794eb`.

## Knowledge base

- `docs/kb/ui.md`: focus semantics, bounds, read-only behavior and primary references.

## Remaining work

- Cycle 07 is complete in this commit. Cycles 08-30 remain unimplemented.
- Cycle 08 research confirmed that the existing a11y endpoint uses Playwright
  DOM snapshots, which can differ from Chromium CDP AX data. A button containing
  an empty-alt image with title Save gets Playwright name Save but empty native
  AX name. Source-aware native inspection is planned; it is not implemented yet.
- Signed-in external scenarios still await a user-selected test profile.

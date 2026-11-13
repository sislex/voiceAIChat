---
title: chat-only-ui-acceptance
date: 2026-10-28
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-only-ui-acceptance

## Changes

- Verified the installed Core UI 1.5.31 provenance against owner source commit
  `14b837d944b2377e84d6411b9e52111164280697`.
- Updated owner settings/sidebar browser checks to 1440×900 and 360×800 and added
  360×800 to the full-App palette focus matrix in both themes.
- Existing DOM regressions cover Analytics absence/outage, tariff filtering,
  machine-gated storage reads, TTS presence and first-run state.

## Validation

- Core model-notice regression: 10 tests passed.
- Core `npm run gate:fast`: passed (documentation-only Core diff).
- Core UI owner commit `e8d2abc` on `SISL-767`: `npm run gate:fast` passed
  with exit 0 (206.79 seconds), including 1,292 UI tests, 38 browser tests,
  workspace typechecks, web and Storybook builds. The separate ChatColumn suite
  passed 93 tests. The initial foreground gate exceeded the MCP timeout; the
  completed background run retained its log and explicit exit status.

## Knowledge

- Updated the existing Core UI test ownership section in `testing-operations.md`.
- Runtime fixes already belong to the installed release; this task extends exact
  viewport acceptance without changing deployment or publishing an archive.

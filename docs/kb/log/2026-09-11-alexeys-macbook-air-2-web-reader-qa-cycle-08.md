---
title: web-reader-qa-cycle-08
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-qa-cycle-08

## What changed

- Added a bounded native-only `accessibility {selector}` action backed by
  Chromium CDP, with the browser-computed role, name, description, ignored
  reasons, name-source precedence, selected AX properties and safe related-node
  selectors.
- Wired the action through shared contracts, Browser Runner, Playwright Reader,
  Web Reader MCP and the standalone panel. Proxy mode now reports that Chromium
  is required instead of returning DOM-derived evidence.
- Reclassified empty button, link and heading names from observed defects to
  heuristic candidates and linked them to native evidence for confirmation.
- Added 30 capability checks plus privacy, mutation, identity, limit, timeout,
  cleanup, ownership, App/MCP and proxy-boundary coverage.

## New verified facts

- The existing `a11y` action is Playwright's DOM-derived ARIA snapshot, while the
  new action reads Chromium's accessibility tree directly. The two sources can
  disagree: an empty-alt image with a title named its parent button in the
  Playwright snapshot but not in Chromium CDP.
- Public read-only runs completed on Google, Facebook and Instagram without
  accepting consent or attempting login. Google and Facebook controls underneath
  their consent layers were ignored with `ariaHiddenSubtree`; Instagram's visible
  password-reset link exposed its native role and name.
- The quiet required-gate retry passed: `gate:fast` took 879.91 seconds and ran
  760 selected E2E tests; pre-commit `gate` took 763.06 seconds and ran 769
  selected E2E tests. Both exited 0.

## Documentation

- `docs/kb/ui.md`
- `docs/plans/web-reader-model-qa-30-cycles.md`

## Remaining work

- Cycle 09 covers images and responsive assets. Signed-in public-site coverage
  still needs a user-supplied existing browser profile; credentials are not
  stored in the Reader contract or test fixtures.

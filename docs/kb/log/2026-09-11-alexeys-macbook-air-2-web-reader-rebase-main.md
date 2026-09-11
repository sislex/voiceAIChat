---
title: web-reader-rebase-main
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-rebase-main

## What changed

- Rebased `codex/web-reader-20-cycles` onto `origin/main` after the Make
  localization merge.
- Rebased the completed eight-cycle branch again after `origin/main` merged the
  dedicated Make dependency-gate correction in PR 135. Git discarded the now
  duplicate catalog and affected-check edits while retaining the browser-load
  stabilization and fixture corrections.
- Regenerated the KB index at each rebase conflict, as required for the generated
  file, and refreshed the rewritten cycle commit references.
- Added `make-contracts` to the `make-ui` application catalog build dependencies
  and to the legacy affected-check graph for `make-app`.

## New verified facts

- The localization merge added `@voicechat/make-contracts` to
  `@voicechat/make-app`, but its application catalog entry did not include the
  cross-owner build dependency. The post-rebase gate detected the mismatch before
  running builds.
- `node --import tsx --test scripts/application-gate.test.mjs` passes all 14 tests
  after the catalog correction. Shared typecheck also passes.
- The first full branch gate exposed the matching omission in
  `scripts/affected-check.mjs` and stopped in the root contract phase (56/57
  checks passed). Adding the same edge to `PACKAGES[].dependsOn` makes the focused
  affected-check suite pass all 44 checks.
- The first post-rebase fast gate saturated concurrent Chromium workers and had
  17 unrelated Browser Runner timeouts. A package-only run reduced this to two
  load-sensitive failures; both affected files then passed together, 24/24 in
  9.81 seconds. A four-worker gate left one completed download stress case over
  the default five-second deadline. Browser Runner now owns a four-worker ceiling
  and a 15-second per-test deadline, while retaining its 60-second hook deadline.
- A later fast-gate pass exposed a second timing fixture from the localization
  merge: the Make MCP test gave its live task-scope token only 100 milliseconds,
  so it could expire before the assertion under gate load. The live token now has
  ten seconds; the separate already-expired token still verifies expiry behavior.
- The next retry exposed the same fixture-scale problem in Browser Runner's
  prompt/evaluate test: its 100-millisecond action budget could expire before the
  dialog event arrived. A one-second budget followed by a 1.2-second unanswered
  pause preserves the intended assertion that dialog waiting stops the budget.
- The final `gate:fast` retry passed with exit code 0 in 1,087.27 seconds,
  including 845 Browser Runner tests and 29 real Chromium Reader E2E tests.
- The next full gate reached all application suites but found that Chromium had
  restored the scroll position from an offscreen native-probe fixture when the
  same URL loaded its visible comparison. The fixture loader now resets scroll
  restoration and the viewport origin after every navigation.
- The final full branch gate passed with exit code 0 in 820.82 seconds. It
  included all 845 Browser Runner tests and 771 application E2E tests in real
  Chromium before the later PR 135 rebase.
- After rebasing onto PR 135, `npm run gate:app -- web-reader` passed with exit
  code 0 in 162.03 seconds. The selected package checks and production build were
  green, followed by all 725 dedicated Web Reader E2E tests in real Chromium.

## Documentation

- `docs/kb/conventions.md`
- `docs/kb/testing-operations.md`

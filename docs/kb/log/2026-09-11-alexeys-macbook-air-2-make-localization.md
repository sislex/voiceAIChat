---
title: Russian and English localization for Make
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Russian and English localization for Make

## Changes

Added a persistent language selector to Make and shared-project views, typed
bilingual interface/system catalogs, localized dialogs, hints, notifications,
validation, starter metadata, accessibility reports, and public pages. Interface
language stays independent of preview emulation and project source. Known HTTP
errors retain their codes and user details; project and mock payloads are excluded.

The shared editor accepts translated loading/completion labels. Make adapts Monaco
controls using its MIT Russian catalog without replacing the editor or discarding
a draft. The catalog has a reproducible update script and upstream license.
Shared dialogs and notifications accept application-specific language/labels and
an optional locale store, so messages already visible in portals update without
losing confirmation input;
Make now requires host API 1.1.0, while the new host still accepts older panels.

Public pages propagate explicit language through password redirects. Guest comment
feedback also covers network failures; a scoped hidden rule prevents the inline
grid style from keeping a closed form visible. Chromium caught `document.URL`
shadowing the constructor in the inline language handler; explicit `window.URL`
fixes navigation. The editor toolbar wraps translated controls in narrow splits.

## Findings and validation

All 868 literal translation calls were checked for missing interpolation values.
A write-only storage failure now preserves the current choice in memory instead
of restoring an older readable preference.

The existing preview-language control changes the project document's language;
it was not an interface locale. Local storage holds the panel preference, a cookie
serves same-origin public requests, and explicit query parameters cover isolated
hosts. Monaco's ESM labels need a control adapter; changing only React text does
not translate its find widget. Starter prompts and snippet descriptions originate
in shared metadata and need translation coverage as well.

The in-app browser connection failed before bootstrap with a missing sandboxPolicy
field. Browser validation therefore uses the repository's Playwright/Chromium
fixture with temporary data and a free port, without starting a server on 8787.

Final validation:

- `npm run gate:fast` exited 0: 8,460 passing test executions across 35 suites,
  including 141 Make UI tests, 94 Make backend tests, 19 Make contract tests,
  and 15 Chromium scenarios. Typechecks and selected builds also passed.
- The pre-PR `npm run gate` also exited 0 with the worker limits described below:
  the same 8,460 passing test executions across 35 suites, all 15 Chromium
  scenarios, typechecks, and selected builds. This run took approximately
  17 minutes; its log is `/tmp/make-localization-pr-gate-3.log`.
- The nine Make browser scenarios cover both locales, live Monaco controls,
  draft preservation, persistence, desktop/mobile layout, password errors, and
  failed/successful guest comment submissions. The six artifact scenarios also
  verify the shared host, desktop `file://` loading, versions, and integrity.
- English, Russian, and mobile screenshots were inspected after fixing the editor
  toolbar. No listening test process remains in the task worktree.
- `git diff --check` passed. The final gate took approximately 13 minutes.

The earlier gate failures exposed a snapshot label mismatch and the public URL
handler bug. Both were fixed and included in the successful final run.

The first pre-PR `npm run gate` stopped on the unchanged browser-runner prompt
evaluation test: its 100 ms execution limit expired before the dialog event
arrived (138 ms reported). All 28 tests in `sessionEvaluation.test.ts` then passed
in isolation without source changes. The second attempt passed that case but hit
the unrelated diagnostics subprocess's 8-second deadline while other test runs
were active on the machine. The whole browser-runner suite then passed all 329
tests with `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=2
VITEST_MIN_THREADS=1`. These settings cap worker concurrency without skipping
tests or changing their deadlines. The successful complete pre-PR gate used the
same limits, including both previously failing cases.
Failed logs are `/tmp/make-localization-pr-gate.log` and
`/tmp/make-localization-pr-gate-2.log`.

## Knowledge updated

- docs/kb/ui.md
- docs/kb/shared.md
- packages/make-app/AGENTS.md
- packages/make-contracts/AGENTS.md
- apps/make/AGENTS.md

## Workspace

Work is isolated on `feat/make-localization` from the merged English-documentation
change. The original worktree's unrelated KB notes remain untouched. The follow-up
PR request authorizes committing and pushing this branch and opening a pull
request against `main`; merging and deployment are outside this request.

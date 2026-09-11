---
title: Fix Make dependency graph regression in release 0.1.296
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Fix Make dependency graph regression in release 0.1.296

## Cause and changes

Localization added `@voicechat/make-contracts` to the Make UI manifest but omitted
the dependency from both explicit graphs: `PACKAGES[].dependsOn` and the
application catalog's `buildDependencies`. The release's first regression stage
caught the legacy graph mismatch. Reproducing that check and running the catalog
suite exposed the second omission as well.

Both edges are now present. Application gates validate both graphs against the
workspace manifests before selecting or running checks, including explicit
application gates and dry runs. The existing root regression assertions use the
same validators. New regression tests remove each edge and verify that the gate
rejects it immediately; selection tests ensure Make contract changes include the
panel and its hosts. Manifest validation does not expand an internal application's
test selection.

## Validation

- Reproduced the reported `make-app -> make-contracts` failure before editing.
- The first targeted run also exposed `make-ui -> make-contracts` in the catalog.
- `node --import tsx --test scripts/application-gate.test.mjs scripts/affected-check.test.mjs`
  passed all 60 tests, including the reported release suite and both missing-edge
  regressions. Log: `/tmp/make-gate-fix-regression-2.log`.
- `VITEST_MAX_FORKS=2 VITEST_MIN_FORKS=1 VITEST_MAX_THREADS=2 VITEST_MIN_THREADS=1 npm run gate:fast`
  exited 0. Because gate infrastructure changed, it selected the full repository
  gate: all typechecks, 8,828 passing test executions (94 Node tests and 8,734
  Vitest tests), builds, and all 255 Chromium scenarios across 26 E2E files.
  The run took approximately 16.5 minutes. Log: `/tmp/make-gate-fix-full.log`.
- The pre-PR `npm run gate` also exited 0 with the same worker limits: all
  8,828 test executions, typechecks, builds, and 255 Chromium scenarios passed.
  It took approximately 9.4 minutes. Log: `/tmp/make-gate-fix-pr-gate.log`.
- `git diff --check` passed. No application or test deadlines were changed.

## Knowledge updated

- `docs/kb/testing-operations.md`: dependency graph validation and why the earlier
  package-only gate missed the release regression.

## Workspace

The fix is isolated on `fix/make-localization-dependency-gate`, based on
`origin/main` at `17cc6b29`. Release `0.1.296` contains that commit plus only a KB
index update. The original worktree's unrelated changes and the release checkout
remain untouched. The follow-up request authorizes committing and pushing this
fix and opening a PR against `main`. Updating the release branch is a separate
step after the fix is merged.

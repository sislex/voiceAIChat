---
title: direct-library-dependencies
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Direct library dependencies

## Implemented

UI Kit/Foundation source, internal tests and primitive stories are owned by
https://github.com/sislex/sielexa-ui (PRs #1/#2). Release v1.0.1 uses commit
`63c02ccfe3e6089d5192591220e740cfd8b96347`, with UI Kit 0.1.2 and Foundation 0.1.4.
Its gate passed 339 workspace tests, both typechecks, Storybook build, real
Chromium smoke and package integrity/file checks. GitHub checks passed before
release. Archive source metadata and integrity are pinned in `vendor/ui-libraries.json`.

Core removes both local library workspaces and the platform SDK wrapper. SDK
consumers import the pinned `@sislexa/sdk` 1.1.0 directly. Public stylesheet imports
replace relative source paths. Catalog metadata records external owners and an
explicit gate request for their internals fails with the owner repository URL.
Core's static import check continues to reject unavailable public library exports.

Pure primitive stories and owner assertions are removed after owner gates. The
Skeleton/TaskCard composition remains Core. Identity PR #6 owns profile/session
breakpoint checks (`211ad740c88256ba0b3b993c2567653898d7b311`). Core gives the public
ToastProvider layout variable an explicit idle CSS value rather than scanning the
library implementation to infer its existence.

## Validation and remaining work

Targeted gate planner/build/import checks passed. Full canonical Core gates,
consumer release and production rollout remain in progress. Other application
adapters and LLM Runner are explicitly outside completion of this increment.
Knowledge updated in architecture.md, ui.md and package/root agent instructions.

The first full consumer gate exposed a real installed-package failure in Core
Storybook: dependency optimization ignored the owner's JSX configuration and
rendered `UiProviders` with an undefined global React. UI PR #3 adds explicit
automatic-runtime pragmas and a packed-package rendering check in a fresh consumer
without tsconfig. Owner gate and CI passed; Core now pins corrected UI Kit 0.1.2
and Foundation 0.1.4 from the merged 1.0.1 source. The failed consumer gate is not
counted as validation; canonical checks must pass against these corrected pins.

Identity's exact historical UI peers blocked npm resolution. Identity PR #7
updates the compatibility ranges and pins the owner UI release. Core consumes
the exact validated 1.2.2 source archive at
`c4609b363de2ff69a7051430bf18eb80c13a6dd6`; API service rollout remains separate.
Clean `npm ci` and all 14 Core QA-panel Chromium checks passed with UI Kit 0.1.2
and Foundation 0.1.4. The full gates still need to pass for this final dependency set.

The full gate then exposed a virtual-browser-fixture dependency scan gap: the
Kanban DnD import was optimized after React mounted, mixing optimizer generations
and producing an invalid hook dispatcher. The accessibility harness now declares
its real TSX entry and a dedicated Vite cache. All 15 accessibility browser cases
passed with these settings; errors retain stacks for actionable diagnostics.
The full gate is repeated after this correction rather than counting its failed run.

A later full run failed in the old delegated Image Studio suite: an asynchronous
view write raced temporary-directory deletion. The owner fixes/drains that work
and retains a deterministic regression. Core's 25 remaining external adapters
now check source/package provenance instead of running owner unit/typecheck
scripts. Direct test/typecheck delegation is rejected. This advances the requested
test-ownership boundary; builds and wrapper removal remain unfinished. Public
consumer compilation and Core bridge tests remain mandatory. Both canonical gates
must pass against this final change set before release.

The final canonical `npm run gate:fast` exited 0 after the ownership boundary and
virtual-entry fixes, including all 119 Core browser cases. The pre-PR canonical
`npm run gate` is the remaining check for this increment. Earlier failed runs are
retained as diagnosis, not counted as acceptance.

Both final canonical gates exited 0: `npm run gate:fast` and `npm run gate`,
including all 119 browser cases in each run. This validates the current consumer
change only; release/deployment and remaining extraction steps are still pending.

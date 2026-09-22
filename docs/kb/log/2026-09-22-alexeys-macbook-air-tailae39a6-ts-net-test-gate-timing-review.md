---
title: test-gate-timing-review
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Test gate timing review

Reviewed the successful Core branch gate `20260922110632748-4f78bc42-0d76-4b24-b599-2d98aade6de6` without rerunning application tests. Browser budgets and API/browser integration consumed about 76% of its 505 seconds. The KB search returned obsolete pre-extraction frontend build stages; corrected the existing testing-operations section against package.json and full-gate.mjs. No test selection or runtime behavior changed.

Recommended next investigation: replay representative diffs through the gate planner, identify unnecessary browser/full-suite selections, and profile browser setup before changing concurrency. The full-fallback timing alone does not prove that ordinary development changes run the full gate.

## Implementation

Scoped known E2E, browser configuration, budget and reviewed tooling edits. Preserved full fallback for unknown/build/deploy/gate inputs and full application suites for source edits. Combined contract consumer checks. Added a reproducible 20-scenario audit and per-command timing evidence. The complete gate now includes every retained browser suite exactly once; reviewed functional suites can use two workers while performance/native suites remain serial.

Restored the missing applicationFrontends server type declaration discovered by typecheck. A real budget run exposed mutable external font CSS; recording actual URL/body variants preserves honest measurement without discarding prior route observations or raising budgets. Regression tests exercise selection, mixed diffs, failure propagation, worker isolation and changed CSS cost. The full development gate passed in 341 seconds, retaining all suites and original skips. Browser integration took 135.25 seconds; the 20-case audit narrowed full fallback from 12 to 4 cases. Projects E2E and artifact verifier scoped runs passed in 8.08 and 10.62 seconds respectively. See docs/plans/test-gate-scope.md for the branch validation and timing limits.

The final branch gate passed in 350 seconds, confirming the same complete suites and stable two-worker browser execution. Production health remained 0.1.326; runtime code and deployed assets were unchanged.

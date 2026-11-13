---
title: release-train-resume-owner-source
date: 2026-10-28
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# release-train-resume-owner-source

## Changes

- Retry incomplete from-dev owner preparation from the current origin/dev only when it descends from the saved source; persist source transitions before preparation and report them in output.
- Reset partial train edits before retrying. Preserve completed owner steps and reject rewritten dev history with a request for a new plan.
- Include the launching Core checkout's tsx dependency in planner prerequisites.
- Reuse the next published patch at its tag SHA when dev is identical or only changes docs/kb; skip prepare/push/publication and retain verification.
- Do not reconcile KB topics without a bump commit; clean ignored partial output on prepare retries while retaining node_modules.

## Verified findings

- Preparation previously reused the planned source after kb:check failed, retaining partial version edits in the clone.
- The run CLI already checked tsx before execution, but the read-only planner did not report it.
- The snapshot restore test needs Python with hashlib.scrypt. The machine's system Python lacks it; the installed Python 3.12 passes the isolated failing test when selected as python3 through PATH.

## Documentation

- docs/kb/deploy.md#release-train-execution-c01

## Validation

- All 70 release-train tests pass, covering resumed KB fixes, unchanged/rewritten/unrelated dev, dirty and ignored clone output, published release reuse, and no-bump preparation.
- npm run gate:fast passed (exit 0) with the installed Python 3.12 selected as python3 through PATH and VC_E2E_WORKERS=1. Run: 20261028124344518-16a1dd9c-c949-4919-bde1-46d9bc075c3e.
- The earlier browser run timed out in the unchanged universalSearch project navigation scenario; all 18 tests passed in the isolated test:files rerun and the final complete gate.

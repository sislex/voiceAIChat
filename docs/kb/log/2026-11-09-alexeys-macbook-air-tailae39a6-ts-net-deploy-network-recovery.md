---
title: deploy-network-recovery
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# deploy-network-recovery

## Changes

- Added npm download retries to the Core Docker build.
- Recover known failed Compose operations when health and readiness verify the previous runtime.
- Build Core in the attached Release Center step so build errors return before health polling.

## Verified findings

- Release Center uses scripts/prod/release-manager-deploy.sh; it previously returned only the detached launch acknowledgement.
- A failed command can reconcile without composeCompleted when its nonzero exit code and previous runtime are known. Unknown completion remains blocked.

## Documentation

- docs/kb/deploy.md#controlled-deployment-operation-status

## Validation

- Targeted Node tests: 19 passed, including a real npm ci against a reset HTTP connection.
- Release-manager wrapper tests: 4 passed.
- Shell syntax checks passed.
- Required npm run gate:fast was attempted twice through remote bash (CI tools were unavailable). Both calls reached the 300-second tool limit during browser integration. Typecheck, all workspace/tooling tests, frontends and Core UI artifact verification completed with exit 0 in both runs; neither aggregate gate is claimed as passed.
- The remaining npm run test:browser stage completed separately with exit 0. All selected stages passed, but a single uninterrupted gate:fast still needs a runner with a longer command budget.

## Scoped KB gate repair

The supervisor completed gate:task at c5fd9ebe4 with exit 0 in 48.750 seconds.
The remaining failure was freshness of six topics sharing the changed areas.

- features/ci-runner.md: compared all areas since f82b55f09; Dockerfile retries, Make server wiring and conversation assistant_mode do not alter CI orchestration. Reviewed the removed CiRepo workflow methods and corrected the obsolete getCiRunLog claim.
- features/feature-preview.md: compared areas since 26f657327; only Dockerfile and database.ts changed. Preview Compose, registry and Kanban bridge are unchanged; documented the shared image retry policy.
- features/releases.md: reviewed deploy.sh, release-manager-deploy.sh and the area diff since f82b55f09, including application-gate.mjs and ipc.ts. Documented attached build errors and recovery, distinguished legacy launcher behavior, and retained the development/release gate boundary.
- stt-runner.md and tts-runner.md: compared their complete areas since f82b55f09. Only Dockerfile and Make user-stand wiring in server.ts changed; voice clients, session.ts, config.ts and Compose are unchanged.
- testing-operations.md: compared areas since 927d6bc37; reviewed the six changed deployment/build/test files and documented the regression coverage.
- Updated all six checked markers through the KB CLI after review. Existing unrelated stale topics remain for the supervisor's scoped check.

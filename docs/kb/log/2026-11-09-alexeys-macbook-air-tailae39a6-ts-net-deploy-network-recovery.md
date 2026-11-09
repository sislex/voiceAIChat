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

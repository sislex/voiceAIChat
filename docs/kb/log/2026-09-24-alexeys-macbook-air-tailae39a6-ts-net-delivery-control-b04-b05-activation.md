---
title: delivery-control-b04-b05-activation
date: 2026-09-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Delivery Control B04/B05 activation

## Completed

- B04 published in delivery-control main at b4207519477d8c11afd4ebc9ffaa62e4fada2a76;
  operator CLI, drain/cancel/retry, chunked artifacts, retention and backup recovery.
- B05 published in Core main at 95eaf002fa9c266891e0ba837c463ac0b2be8395;
  versioned release tooling with host lock, trusted verifier contract, fencing,
  durable receipts and uncertain-outcome reconciliation.
- Activated coordinator 0.3.0 on the existing LLM Runner host after a private
  pre-migration snapshot; updated daily backup service and ran it successfully.
- Recorded B04/B05 external acceptance; shared-chat-v1 remains paused at S0.

## Verified facts

- Owner gates, disposable PostgreSQL integration, three-worker fault/cancel
  scenarios and real synthetic binary-artifact backup/restore passed.
- Core's exact-tree full gate passed with release-tooling regression tests,
  workspace tests, builds and browser integration.
- State v3 adds retry limits; existing tasks and source verification remain intact.
- Daily retention manages validated new-format pairs; two legacy backups remain
  outside automatic retention. No off-host replication or secret escrow exists.
- LLM Runner container identities, start times and health remain unchanged.

## Knowledge updated

- docs/kb/deploy.md: current release provenance, rollback snapshot, backup service,
  bootstrap acceptance and owner documentation links.

## Remaining work

- B06: trusted verifier/report validation, publication and release orchestration,
  browser activation commissioning, production QA/defect loop and stage acceptance.
- No product deployment, production worker enrollment or S0 completion is claimed.

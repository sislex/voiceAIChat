---
title: sisl-885-tunnel-error-boundary
date: 2026-11-12
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl-885-tunnel-error-boundary

## Verification and updates

- Reconciled machines.md from f82b55f09 through 5592d5709: CoreTunnel error
  handling and its 12-case regression matrix; ChatRepo assistant-mode/session
  invalidation and project-filtered usage; turns.ts Required-context/tool gating
  and Make browser selection; REST/IPC mode validation and snapshot previews.
- Reviewed repository method removals and environment-link test fixture changes:
  Kanban workflow mutators are no longer Core APIs; fixture writes use test/seed.ts.
- Reconciled server-internals.md from 92494505 through 5592d5709 against
  makeBridge/coreRpc.ts and its tests (three project-context dispatch methods and
  openStandWindow argument typing), plus the CoreTunnel boundary.
- Updated both existing topics, recorded freshness with the configured CLI and
  regenerated the KB index.

## Gate evidence

The supervisor's development gate passed all 15 CoreTunnel tests with exit 0.
Its subsequent scoped KB check failed only for machines.md and
server-internals.md. After reconciliation, kb:check --strict no longer lists
either topic; its remaining 30 stale topics match the supervisor's pre-existing
exemption list. The full workflow rerun remains the supervisor's responsibility.

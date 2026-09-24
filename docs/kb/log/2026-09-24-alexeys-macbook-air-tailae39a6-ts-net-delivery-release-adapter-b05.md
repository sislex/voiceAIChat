---
title: delivery-release-adapter-b05
date: 2026-09-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# delivery-release-adapter-b05

## Changes

Added the Core delivery-control v1 tooling adapter for exact-SHA owner gates,
immutable release-set manifests, observed OCI versions/digests, shared host flock,
fenced effects, durable receipts and explicit interrupted-release reconciliation.
No product runtime code or production deployment was changed.

## Findings and verification

The existing application catalog, public release contracts and Docker deployment
adapter already provide owner validation, dependency checks, healthy composition
observation and targeted rollback. B05 wraps these interfaces and retains a durable
environment barrier after unknown outcomes. Isolated tests cover no-op, failed
health/rollback, replay, changed candidate, stale authority, restart reconciliation,
owner checkout provenance and a real kernel lock held through process exec/death.
Full owner-gate validation is recorded in the implementation handoff.

## Knowledge updates

- `docs/kb/deploy.md`: current adapter boundaries and evidence semantics.
- `docs/delivery-release-adapter.md`: public v1 CLI, host configuration, verifier
  contract and B06 commissioning requirements.

## Remaining scope

B06 supplies authenticated live lease verification and trusted candidate reports,
publication, browser activation commissioning, stage ordering and production QA.
The v1 OCI adapter rejects data migrations and new installations without an
established artifact rollback path. Isolated tests do not claim a live rollout.

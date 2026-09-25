---
title: controlled-ui-delivery-authority
date: 2026-09-25
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Controlled UI delivery authority

## Changes

Added a controlled UI entrypoint under the existing host lock, exact previous
UI generation/active release checks, manifest-byte binding, live authority checks
and a durable operation journal. Reconciliation observes lost activation replies
without repeating activation. Known staging cleanup failures retain their path
and barrier until cleanup succeeds. Legacy manual commands remain compatible.

## Knowledge recorded

Documented the version-2 owner CLI contract, envelope fields, journal states,
non-preemptive external commands and the remaining delivery-control broker and
production acceptance responsibilities in docs/delivery-release-adapter.md and
the existing deployment KB topic.

## Validation and remaining work

Fourteen focused browser CLI/host-wrapper checks passed on macOS. The eleven
controlled-owner scenarios also passed on Linux under a bounded transient unit
with disposable Git-free/Docker fixtures. The final `npm run gate` selected and
passed gate:all (284.28 seconds), including workspace checks, builds and browser
integration. No Core rollout, UI activation or production acceptance was performed
by this change.

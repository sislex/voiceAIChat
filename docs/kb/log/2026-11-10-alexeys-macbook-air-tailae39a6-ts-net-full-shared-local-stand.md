---
title: full-shared-local-stand
date: 2026-11-10
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# full-shared-local-stand

## Changes

Expanded Core files/git component selection to the authorized Kanban manifest.
Added full shared service mode, prepared owner sources and secondary process supervision.

## Verified facts

Both projectAdapters and coreRpc restricted components to three names. Shared mode
previously reused all other service URLs. Full mode retains shared persistent state
and disables Kanban background work.

## Topics

- docs/kb/deploy.md
- docs/kb/server-internals.md

## Commissioning

Live stand migration and removal of the operator launcher remain separate from
checkout implementation and process-fixture validation.

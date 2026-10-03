---
title: environments-v4-shared
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# environments-v4-shared

## Changes

- Added replica placement, network fields and migration operation/stage contracts with strict parsers and 51 tests.

## Findings

- Legacy machineId keeps its wire shape and single-replica placement semantics; machineIds is mutually exclusive.

## Documentation

- docs/kb/shared.md

## Remaining work

- Shared typecheck and all 1050 tests pass when invoked directly through Node. npm wrappers exit 255; the affected planner cannot spawn git (EPERM).
- The supervisor must commit the contracts first, build 0.1.17 from that SHA and pin its archive/provenance in a second commit, following 0.1.16. This task explicitly prohibits creating commits, so no archive with inaccurate provenance was generated.

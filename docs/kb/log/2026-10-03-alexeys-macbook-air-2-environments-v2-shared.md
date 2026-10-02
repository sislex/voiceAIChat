---
title: environments-v2-shared
date: 2026-10-03
machine: alexeys-macbook-air-2
author: unknown
---

# environments-v2-shared

## Changes

- Added environments-v2 shared contracts, pure parsers, managed stand paths, FNV-1a identities, and stand manifests.
- Added 104 parser/layout/identity tests. Shared typecheck and all 986 Shared tests pass via direct Node commands.

## Findings

- The affected-test planner cannot spawn Git in this sandbox (EPERM), so its fallback is the full repository gate, reserved for the supervisor.
- npm script subprocesses exit 255 here; direct Node execution of TypeScript, Vitest and KB scripts works.

## Documentation

- docs/kb/shared.md

## Remaining release work

- The user prohibits commits in this checkout. The supervisor must commit contracts first, build 0.1.15 from that SHA, and pin the archive/provenance/snapshot in a follow-up commit. Building from the unchanged HEAD would falsely attribute new contracts to an older commit.
- Run the required gate outside the sandbox: npm run gate:changed -- --base 59f2ddf5044b2901ebb674c871eb6fceaf9193ce.
- KB touch could not resolve HEAD through its subprocess; checked was repaired from the successful direct git rev-parse HEAD output.

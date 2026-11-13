---
title: make-git-compare
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-git-compare

## Changes

- Added read-only comparison of two Git refs through the workspace service and Make bridge.
- Covered actual Git histories, read permissions, failed fetch, component routing and RPC result validation.

## Verified findings

- Upstream ahead/behind does not establish containment in dev. Compare the conversation head with origin/dev after fetching.
- Core consumes versioned owner contracts, so its compatibility adapter validates the new operation until the next owner pin.

## Documentation

- docs/kb/server-internals.md — Project mode / Comparing conversation branches with dev.

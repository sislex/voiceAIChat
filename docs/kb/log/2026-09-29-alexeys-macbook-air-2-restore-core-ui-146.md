---
title: restore-core-ui-146
date: 2026-09-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# restore-core-ui-146

## Work completed

- Restored and verified Core UI 1.4.6 source in `sislex/sislexa-core-ui` commit `9aa5cf3a8c30e5c613a0ccc58b1b5734983124b4`.
- Rebuilt Desktop 1.0.9 against the same renderer and pinned both owner artifacts into Core.

## Findings

- The older Core UI source commit became unreachable, although its archived output remained available.
- Make and Web Reader currently require exact older standalone chat package peers, so their archives remain pinned until coordinated owner releases.

## Recorded in

- `docs/kb/clients.md`

## Follow-up

- Coordinate standalone chat package upgrades with their application owners.

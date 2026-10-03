---
title: agent-contracts-override
date: 2026-10-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# agent-contracts-override

## Что сделано

- Root `overrides` maps `@sislexa/agent-contracts` to the pinned root version.

## Что выяснили (факты, которых не было в KB)

- Release 0.1.373 regression failed on a clean `npm ci` (E404 for `@sislexa/agent-contracts@1.0.0`):
  chat-app/chat-ui archives declare an exact 1.0.0 peer, and the operator gate passed only because
  `node_modules` already existed. Reproduce dependency changes with `rm -rf node_modules && npm ci`.

## Куда занесено

- docs/kb/machines.md.

## Открытые вопросы / что осталось

- Owner archives should relax the peer to `^1.0.0` in their next releases.

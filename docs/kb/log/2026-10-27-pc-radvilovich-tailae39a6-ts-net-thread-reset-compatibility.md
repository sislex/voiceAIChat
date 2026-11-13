---
title: thread-reset-compatibility
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voicechat-ci
---

# thread-reset-compatibility

## Changes

- Restored the published `/thread/reset` endpoint and its Conversation response alongside the new summary reset contract.
- Covered compatibility, active-turn rejection and threadReset settings in HTTP tests.

## Verified facts

- Both reset routes use the turn manager admission lock; the legacy route skips summary refresh.
- The new `/thread-reset` route defaults to summary refresh and returns `{ ok: true, summary }`.

## Updated topics

- docs/kb/llm.md
- docs/kb/protocol.md

## Open questions

- None.

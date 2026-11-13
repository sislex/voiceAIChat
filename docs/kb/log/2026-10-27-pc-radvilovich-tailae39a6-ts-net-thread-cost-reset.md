---
title: thread-cost-reset
date: 2026-10-27
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# thread-cost-reset

## Changes

- Added shared thread-cost/reset contracts, scalar session usage queries, REST routes and canonical threadReset settings.
- Integrated summary refresh and reset with turn admission, including automatic reset, existing chat events and a persisted system note.
- Added fixture and HTTP/turn tests for calculations, provider/session isolation, summary failures, conflicts and settings.

## Verified knowledge gaps

- The previous thread reset only cleared the session/context usage and appended a note; it did not refresh the rolling summary or exclude active turns.
- Claude replies previously lacked a persisted session id. New replies persist TurnMeta.sessionId; older Codex replies can use codexThreadUsage.sessionId.
- The rolling summary refresh handles errors as best effort, so reset checks the returned summary boundary before discarding a session.

## Updated topic

- docs/kb/llm.md — Session cost and summary reset.

## Remaining work

- Core UI consumes the shared contract in its separate owner repository.

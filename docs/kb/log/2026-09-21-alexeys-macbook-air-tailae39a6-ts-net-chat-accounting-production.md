---
title: chat-accounting-production
date: 2026-09-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Chat accounting production acceptance

## Delivered

Core 0.1.318 introduced live Chat accounting with SDK 1.1.0, Billing 1.1.1 and
Runner 0.2.1. Core 0.1.319 then closed the WebSocket initialization gap found by
acceptance. Both releases went through PR/merge, canonical gates, immutable builds,
fresh backups and the installed server deployment command. Current production is
0.1.319 at `c2469456d4ef1c519e61118aea217b1bbe7054dc`.

## Evidence

Two real Codex turns settled 79,978 micro-USD of estimated cost. Numeric receipts
proved resumed-session baseline subtraction, replay did not duplicate spending,
and a finite policy blocked additional execution. The final transport test sent
a command immediately after the first snapshot and received exactly one Billing
refusal before dispatch; existing balance and request count survived restart.
Production account/Image Studio and standalone local studio browser checks passed.
Core plus eight dependencies are ready. Test credentials and CLI profiles were
removed; the fixture is disabled with sessions revoked and audit evidence retained.

## Knowledge and remaining scope

`docs/kb/deploy.md` records exact source/image IDs, backups and the resolved paused
automation deployment failure. `server-internals.md` records the ordered setup
barrier. The architecture plan marks the Chat increment accepted; Make/background
accounting, bounded execution, Analytics and active-time reporting remain pending.

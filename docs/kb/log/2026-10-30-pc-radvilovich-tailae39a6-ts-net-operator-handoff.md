---
title: operator-handoff
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# operator-handoff

## Implemented

Core proxies the Kanban handoff endpoints and exposes an owner/admin machine switch route. AgentRegistry correlates completion with the selected agent; tokens are excluded from responses and audit messages.

## Verified ownership

Kanban owns export/import and run continuation. Agent owns credential persistence, registration probing and fallback. Core only authorizes and relays the reconnect command.

## Documentation

- docs/kb/protocol.md#operator-handoff

## Remaining commissioning

Install compatible owner artifacts and perform the two-card source-shutdown acceptance check separately. No production deployment was performed.

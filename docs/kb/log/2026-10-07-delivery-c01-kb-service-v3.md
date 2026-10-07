---
title: kb-service-v3
date: 2026-10-07
machine: delivery-c01
author: unknown
---

# kb-service-v3

## Что сделано

- Removed implementation knowledge owned by Core UI, UI Kit, Kanban, Agent,
  Make, Web Reader, Playwright Reader, and Image Studio from Core topics.
- Kept only the Core contract, authorization, transport, persistence, and host
  integration parts identified by the assignment table.
- Replaced fully extracted application topics with owner-module stubs and
  corrected Core links that targeted removed sections.
- Registered the UI Kit and Image Studio knowledge bases in the module map.

## Что выяснили (факты, которых не было в KB)

- Cross-module references remain stable at the module index level and do not
  depend on owner-topic anchors.

## Куда занесено

- docs/kb/projects.md, docs/kb/ui.md, docs/kb/operations-app.md,
  docs/kb/admin-app.md, docs/kb/architecture.md, docs/kb/clients.md,
  docs/kb/machines.md, docs/kb/server-internals.md,
  docs/kb/testing-operations.md, docs/kb/image-retouch.md,
  docs/kb/modules.md, docs/kb/protocol.md, and docs/kb/llm.md.

## Открытые вопросы / что осталось

- None.

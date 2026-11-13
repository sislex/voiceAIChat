---
title: core-kb-reconcile-followup
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# core-kb-reconcile-followup

## Что сделано

- Rechecked the architecture and conventions topics against Core UI 1.5.33 pin metadata and the current workspace manifest.
- Clarified how the external Kanban knowledge document is resolved.

## Что выяснили (факты, которых не было в KB)

- `kanban:README.md` is a cross-module document identifier for the registered Kanban repository, not a local Core filesystem path.
- Core UI 1.5.33 changes the pinned owner artifact only; Core ownership and gate conventions remain unchanged.

## Куда занесено

- `docs/kb/projects.md`
- Freshness markers in `docs/kb/architecture.md` and `docs/kb/conventions.md`

## Открытые вопросы / что осталось

- None.

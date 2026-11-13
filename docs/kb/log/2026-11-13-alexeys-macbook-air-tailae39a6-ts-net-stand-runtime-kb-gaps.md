---
title: stand-runtime-kb-gaps
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-runtime-kb-gaps

## Что сделано

- Reconciled the portable stand, KB traversal, remote mirror retry diagnostics and owner-module root identifiers with their implementation.

## Что выяснили (факты, которых не было в KB)

- Kanban's remote Git runner preserves a bounded stderr tail as `gitOutput`; task-runtime uses it to classify transient clone/fetch failures.
- `mirror_lock_wait` records lock contention, not a proven leaked lock; the retry regression must create a real checkout after its injected disconnect.
- `agent:README.md` and `kanban:README.md` are registered owner-module roots, not Core-local files.

## Куда занесено

- `docs/kb/deploy.md`, `docs/kb/kb-workflow.md`, `docs/kb/features/ci-runner.md`, `docs/kb/modules.md`.

## Открытые вопросы / что осталось

- None for the seven reported KB gaps; live stand commissioning remains covered by the earlier validation-limit note.

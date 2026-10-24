---
title: sisl-771-owner-gate-kb
date: 2026-10-24
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sisl-771-owner-gate-kb

## Что сделано

- Закрыты три пробела KB по сбою owner-гейта SISL-771 и стандартному development pipeline.

## Что выяснили (факты, которых не было в KB)

- Owner discovery в sislexa-kanban блокирует shallow и несвязанные истории до формирования плана; отсутствие merge-base не означает отсутствие owner-изменений.
- Порядок стадий development pipeline задан в `packages/shared/src/ci.ts`, а упорядоченные project/task-привязки команд хранятся через `apps/server/src/db/repos/ci.ts`.

## Куда занесено

- `docs/kb/features/ci-runner.md`

## Открытые вопросы / что осталось

- Нет.

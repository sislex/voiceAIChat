---
title: frontend-owner-overrides-kb
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# frontend-owner-overrides-kb

## Что сделано

- Сверены и уточнены правила выбора `VC_APPLICATION_FRONTENDS` и fallback артефактов.

## Что выяснили (факты, которых не было в KB)

- Все frontend ID валидируются до фильтрации по deployment; неизвестный ID всегда приводит к ошибке регистрации.
- Источник выбирается для включённого локального frontend ID или владельца из `runtimeDependencies`; выключенный и внешний владелец источник не активируют.
- Отбрасывание источника не запрещает gateway использовать установленный артефакт владельца, потому что deployment guard сопоставляет только явные application ID.

## Куда занесено

- `docs/kb/ui.md`
- `docs/kb/architecture.md`

## Открытые вопросы / что осталось

- Нет.

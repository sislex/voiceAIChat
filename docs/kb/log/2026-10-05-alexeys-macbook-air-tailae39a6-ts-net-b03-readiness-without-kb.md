---
title: b03-readiness-without-kb
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# b03-readiness-without-kb

## Что сделано

- Проверка готовности (reliability-v2 B03) различает `knowledgeBase: 'connected' | 'absent'`. Если поле не задано, считается `connected`, как раньше.
- Без базы знаний источник из неё не требуется, `docs/**` и README засчитываются как знание. Результат проверки `knowledge_sources` фиксирует, что базы нет.
- С подключённой базой требование источника `knowledge` сохраняется.

## Что выяснили (факты, которых не было в KB)

- Версию `@voicechat/shared` в ядре поднимает только интегратор вместе с архивом: пакеты из `vendor` требуют точную версию, и `npm ci` ломается.

## Куда занесено

- docs/kb/features/task-preparation.md

## Открытые вопросы / что осталось

- Kanban должен передавать признак базы знаний проекта (reliability-v2 C02).

---
title: b02-portable-kb-tools
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# b02-portable-kb-tools

## Что сделано

- Инструменты базы знаний вынесены в пакет `packages/kb-tools` (`@sislexa/kb-tools`, команда `sislexa-kb`, без зависимостей): check, index, log, touch, prepare, search, context, impact (kb-service-v1 B02).
- Работают в любом репозитории по `kb.config.json`; без файла — прежнее поведение ядра. Скрипты `kb:*` ядра вызывают пакет, `scripts/kb.mjs` и `scripts/kb-search.mjs` остались совместимыми обёртками.
- Выпуск архива: `npm run pack:kb-tools`; подключение в репозитории модуля описано в docs/kb/kb-workflow.md.

## Что выяснили (факты, которых не было в KB)

- Нет.

## Куда занесено

- docs/kb/kb-workflow.md

## Открытые вопросы / что осталось

- Выпустить архив и раздать его задачам C03–C06.

---
title: release-failure-summary
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-failure-summary

## Что сделано

- В `@voicechat/shared` Core перенесено изменение `release.ts` из копии Kanban (B05): поля `failedTests`/`failureTail`, сводка причины провала без YAML/TAP-строк.

## Что выяснили (факты, которых не было в KB)

- Причиной провала релиза 0.1.455 было `|-`: первая строка на `^error` в TAP-выводе `node --test` — YAML `error: |-`.

## Куда занесено

- docs/kb/features/releases.md

## Открытые вопросы / что осталось

- В Kanban отличие `release.ts` объявлено в `packages/shared/core-source.json` (`divergent`); убрать при следующем обновлении копии shared.

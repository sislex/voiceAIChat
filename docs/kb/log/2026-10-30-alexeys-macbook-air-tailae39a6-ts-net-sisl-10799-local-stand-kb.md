---
title: sisl-10799-local-stand-kb
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-10799-local-stand-kb

## Что сделано

- Сверены с merge SHA метаданные frontend, перезапуск при смене source/config, local seed и диагностика readiness.

## Что выяснили (факты, которых не было в KB)

- В supervised run ошибка с ограниченным хвостом service log попадает в stderr до остановки групп процессов.

## Куда занесено

- docs/kb/deploy.md
- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Живая acceptance-проверка беседы cf2fda81 остаётся отдельной от документирования кода.

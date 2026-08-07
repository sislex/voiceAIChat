---
title: ci-runner-production-routing
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-runner-production-routing

## Что сделано

- Сверена и отмечена свежей тема CI-раннера после маршрутизации production-команд.

## Что выяснили (факты, которых не было в KB)

- `PROD_DIR` сопоставляется с единственной машиной проекта по нормализованному `path`; шаг запускается на её `agentId` с этим каталогом как cwd. Некорректное сопоставление останавливает шаг с диагностикой.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

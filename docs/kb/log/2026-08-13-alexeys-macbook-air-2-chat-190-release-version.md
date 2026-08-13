---
title: chat-190-release-version
date: 2026-08-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat-190-release-version

## Что сделано

- Зафиксирована защита production-публикации от несовпадения версии подготовленной записи и release-ветки.
- Описан актуализируемый при каждом запуске content-addressed launcher production deploy.

## Что выяснили (факты, которых не было в KB)

- Публикация считается успешной только после совпадения в health одновременно commit SHA и версии релиза.
- Устаревшая установленная копия deploy-скрипта больше не удерживает старую логику передачи release metadata.

## Куда занесено

- `docs/kb/features/releases.md`
- `docs/kb/deploy.md`

## Открытые вопросы / что осталось

- Нет.

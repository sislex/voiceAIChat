---
title: kb-modules-rpc
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kb-modules-rpc

## Что сделано

- RPC ядра для Kanban: `kb.ensureModule`, `kb.removeModule`, `kb.modules` — регистрация базы знаний репозитория как модуля с сохранением в `<VC_DATA_DIR>/kb-modules.json`.

## Что выяснили (факты, которых не было в KB)

- План kb-service-v1 не содержал операции регистрации модуля для Kanban; U01 остановилась на этом. Интеграционное требование добавлено отдельной правкой интегратора.

## Куда занесено

- docs/kb/features/project-knowledge-base.md

## Открытые вопросы / что осталось

- Сторона Kanban (U01).

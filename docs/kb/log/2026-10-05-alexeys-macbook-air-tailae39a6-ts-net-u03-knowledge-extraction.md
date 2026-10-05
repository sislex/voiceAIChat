---
title: u03-knowledge-extraction
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# u03-knowledge-extraction

## Что сделано

- Движок базы знаний выделен в пакет `packages/knowledge` (`@voicechat/knowledge`) без импортов из внутренностей сервера (kb-service-v1 U03): хранение, доступ, вызовы модели и git приходят через явные порты, реализованные в `apps/server`.
- `apps/server` оставил маршруты и сборку; поведение прежнее. Реестр RPC сервиса базы знаний из B01 работает поверх пакета и проверен тестом.

## Что выяснили (факты, которых не было в KB)

- Нет.

## Куда занесено

- docs/kb/server-internals.md — список портов.

## Открытые вопросы / что осталось

- Вынос пакета в отдельный репозиторий и процесс — kb-service-v2.

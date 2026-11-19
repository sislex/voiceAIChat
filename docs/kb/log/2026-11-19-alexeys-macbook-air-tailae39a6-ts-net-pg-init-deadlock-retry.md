---
title: pg-init-deadlock-retry
date: 2026-11-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pg-init-deadlock-retry

## Что сделано

- Инициализация схемы Postgres в `VoiceChatDb.init` повторяется при `deadlock detected` (40P01) до 5 раз; `DROP INDEX idx_environment_active_operation` выполняется только если индекс ещё есть.

## Что выяснили (факты, которых не было в KB)

- Core стенда 23002 падал при старте: его DDL ждал исключительный замок таблицы, а уже работающий Core стенда 25273 на той же базе держал на ней запись. Advisory-замок схемы от этого не защищает — работающий процесс его не берёт.

## Куда занесено

- docs/kb/data-auth.md

## Открытые вопросы / что осталось

-

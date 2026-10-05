---
title: dev-process-rpc
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dev-process-rpc

## Что сделано

- Ядро передаёт запросы `devProcess.*` агенту и отдаёт их Kanban через RPC `machines.devProcess` (стыковка для dev-lane-v1 C03).

## Что выяснили (факты, которых не было в KB)

- Ядро берёт типы сообщений агента из `@sislexa/agent-contracts` 1.2.2, где `devProcess` ещё нет; типы ответов взяты из shared до выпуска контрактов агента.

## Куда занесено

- docs/kb/machines.md

## Открытые вопросы / что осталось

- Сторона Kanban (порт и HTTP-клиент) и повтор C03.

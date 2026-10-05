---
title: kb-module-contracts
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kb-module-contracts

## Что сделано

- Контракт модулей базы знаний (kb-service-v1 B01): `KbModule`, `REST.kbModules`, фильтр `module` в запросах тем, поиска и контекста, идентификаторы файловых тем `<module>:<path>` (без префикса — модуль `core`).
- Типизированный реестр RPC будущего сервиса базы знаний с проверкой входных данных (`kbService.ts`).

## Что выяснили (факты, которых не было в KB)

- Нет.

## Куда занесено

- docs/kb/protocol.md

## Открытые вопросы / что осталось

- Архив shared и движок с несколькими источниками (C01).

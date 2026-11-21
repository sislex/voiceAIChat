---
title: public-build-from-dev
date: 2026-11-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-build-from-dev

## Что сделано

- `npm run public:docker -- --from-dev` собирает тестовый стенд минимальной сборки из dev-рабочих копий: бандл Core UI, образы Identity, Billing и хранилища; `--pinned` возвращает опубликованные выпуски.
- `npm run public:dev -- --detach` запускает дев-режим в фоне, `npm run public:dev:stop` останавливает; службы дев-режима идут в своих группах процессов и останавливаются целиком.

## Что выяснили (факты, которых не было в KB)

- Дев-режим «завершался сам» оттого, что вместе с терминалом получал SIGTERM и гасил службы; Docker-стенд не показывал правки Core UI, Identity и хранилища, потому что брал закреплённые выпуски.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Выпуски Core UI, Identity, Billing и хранилища для обычного `public:docker`.

---
title: release-train-set-version
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-train-set-version

## Что сделано

- Release train вызывает `npm run set-version -- <версия>` у владельцев, у которых есть такой скрипт (Make), вместо собственной правки манифестов.

## Что выяснили (факты, которых не было в KB)

- Make держит одну версию в `apps/make`, `packages/make-app` и `packages/make-contracts`; его гейт падал с `release version drift`, когда train поднимал только корень и приложение.

## Куда занесено

- docs/kb/deploy.md — раздел «Release train execution»

## Открытые вопросы / что осталось

- Нет.

---
title: public-from-dev-identity-ui
date: 2026-11-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-from-dev-identity-ui

## Что сделано

- `npm run public:docker -- --from-dev` собирает Core UI с пакетом Identity из рабочей копии Identity (временная подмена `@sislexa/identity` в `node_modules` Core UI, затем возврат закреплённых копий).

## Что выяснили (факты, которых не было в KB)

- Страница входа, профиль и карточка пользователя в админке — компоненты пакета Identity, который Core UI берёт из закреплённого архива; образ Identity из dev их не меняет.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Для прода правки Identity UI по-прежнему требуют выпуска Identity и пина в Core UI.

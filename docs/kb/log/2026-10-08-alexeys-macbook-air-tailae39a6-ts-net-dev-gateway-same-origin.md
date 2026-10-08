---
title: dev-gateway-same-origin
date: 2026-10-08
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# dev-gateway-same-origin

## Что сделано

- Шлюз стенда (`scripts/dev-gateway.mjs`) пересылает запросы, у которых `Origin` равен адресу самого шлюза,
  с `Origin` целевого сервиса. Тест в `scripts/dev-stand.test.mjs`.

## Что выяснили (факты, которых не было в KB)

- Вход на стенд по адресу шлюза (`http://100.126.46.22:23000`) падал с `origin_denied`: шлюз подменяет `Host`
  на адрес базового стенда, а у Core выключен `trustProxy`, поэтому `Origin` страницы шлюза для Core чужой.
  Запросы с чужих адресов по-прежнему отклоняются.

## Куда занесено

- docs/kb/deploy.md — «Dev stand gateway and Core component (C02)».

## Открытые вопросы / что осталось

- Работающий шлюз на M1 нужно перезапустить из рабочей копии с исправлением.

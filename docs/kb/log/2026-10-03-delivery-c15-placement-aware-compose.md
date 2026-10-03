---
title: placement-aware-compose
date: 2026-10-03
machine: delivery-c15
author: unknown
---

# placement-aware-compose

## Что сделано

- Добавлены placement-aware URL-переменные и отдельный Compose overlay для машин модулей.
- Stand lifecycle проверяет роли primary/module и соответствующие модели Compose.

## Что выяснили (факты, которых не было в KB)

- Production defaults сохраняют прежние адреса сервисов; вторичная машина получает адреса туннелей через stand.env.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Комиссионирование распределённого стенда выполняется последующей операторской проверкой.

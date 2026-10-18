---
title: pin-kanban-0-2-32
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-32

## Что сделано

- Закреплён Kanban 0.2.32 (`c3ab6a36`): общий пароль пользователей стенда `VC_STAND_USERS_PASSWORD`, исправления
  подмены Core и Kanban на dev-стенде (метки моста, адрес ядра, готовность `/v1/health`, без путей контейнера).

## Что выяснили (факты, которых не было в KB)

- Dev-стендами управляет продовый Kanban, поэтому изменения подмены проверяются через API только после деплоя на прод.

## Куда занесено

- deploy/tools.lock.json, docker-compose.yml; docs/kb/deploy.md.

## Открытые вопросы / что осталось

-

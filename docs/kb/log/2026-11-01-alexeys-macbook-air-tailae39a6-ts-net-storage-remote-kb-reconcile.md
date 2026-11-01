---
title: storage-remote-kb-reconcile
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# storage-remote-kb-reconcile

## Что сделано

- Сверены темы после SISL-827 (вход в приложение storage) и SISL-828 (удалённый режим хранилища); большинство затронуто только через общие файлы `server.ts` и `packages/shared`.

## Что выяснили (факты, которых не было в KB)

- В удалённом режиме Core доверенно передаёт пользователя сервису хранения заголовком `x-sislexa-user` вместе со служебным токеном.

## Куда занесено

- docs/kb/architecture.md, docs/kb/data-auth.md

## Открытые вопросы / что осталось

- Сам сервис хранения — репозиторий sislex/storage (S1–S5).

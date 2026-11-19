---
title: public-minimal-build
date: 2026-11-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-minimal-build

## Что сделано

- Пакет `deploy/public/` (Compose, Caddyfile, `.env.example`, README) и `scripts/public-build.mjs` с командами `public:install`, `public:docker`, `public:docker:down`, `public:dev` — минимальная Sislexa для sislexa.by: регистрация и вход, биллинг с дневным лимитом, чат (Chat/Required), хранилище файлов.
- `scripts/component-installation.mjs --applications` — установка только выбранных компонентов (core, identity, billing).
- `scripts/prod/component-rotation.sh --project` — продление токенов в пределах одного Compose-проекта.
- Вложения чата уходят в хранилище, если в тарифе пользователя нет машин (`chatFilesUseStorage`).

## Что выяснили (факты, которых не было в KB)

- Core и Identity должны подписывать сессии одним секретом, иначе у биллинга нет сессии пользователя и любой ход падает с «нужно восстановить исходную сессию входа».
- Компоненты проверяют версию друг друга: Core должен сообщать версию релиза и коммит из 40 hex-символов.
- Адрес внешнего приложения — только https или http на loopback: хранилищу нужен отдельный хост `files.`.
- Billing не стартует, если дневной лимит в настройке отличается от сохранённого при первом старте.

## Куда занесено

- docs/kb/deploy.md, deploy/public/README.md

## Открытые вопросы / что осталось

- Изменение дневного лимита без правки базы Billing; данные отдельного сервера, SMTP и раннер для него — за владельцем.
- Проверка Docker-стенда нашла ещё два дефекта: сервис хранилища и Core делили таблицы `storage_*`
  в одной базе (у хранилища теперь своя база `storage`), а очередь публичного чата вставала на паузу,
  пока учитывалась стоимость предыдущего ответа, и сама не продолжалась (теперь продолжается после
  расчёта, `resumeAfterAccounting`).

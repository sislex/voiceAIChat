---
title: codex-shared-auth-source-profile
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# codex-shared-auth-source-profile

## Что сделано

- Диагностика «Codex не работает» на сервере 89.125.68.35 (стек ChatAI в docker
  compose: voiceaichat-*). Причина найдена и устранена: при
  VC_CODEX_SHARED_AUTH=true + VC_CODEX_SHARED_AUTH_USER=admin источник общего
  Codex-auth — профиль админа (/data/cli-users/YWRtaW4/.codex/auth.json), а не
  HOME. Свежий codex login выполнили в HOME (/home/node/.codex), профиль админа
  остался с токеном от 23 июля → реальный прогон падал с 401 invalid_refresh_token.
- Фикс: скопировал рабочий токен HOME → профиль админа (старый сохранён как
  auth.json.stale-bak). Прогон под профилем админа заработал; остальные профили
  пересеиваются автоматически на следующем ходе (seedFile overwrite=true).

## Что выяснили (факты, которых не было в KB)

- KB (deploy.md) говорила «синхронизируется из HOME/.codex/auth.json» — неточно:
  cliProfiles.ts (стр. 99-102) при заданном sharedCodexAuthUser читает из профиля
  этого пользователя, а не из HOME. Исправлено в KB.
- `codex login status` показывает «Logged in using ChatGPT» и на протухшем токене —
  доверять надо реальному прогону `codex exec --json`, а не статусу.
- Codex стоит только в runner-work; в runner-personal выключен VC_CODEX_BIN=/bin/false.

## Куда занесено

- docs/kb/deploy.md — раздел «Аутентификация CLI живёт в контейнере»: источник
  общего auth = профиль VC_CODEX_SHARED_AUTH_USER, ловушка codex login → HOME,
  как логиниться правильно.

## Открытые вопросы / что осталось

- Токены ChatGPT-логина протухают → общий Codex-auth надо периодически обновлять
  в профиль-источник. Автоматической ротации нет.

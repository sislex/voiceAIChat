---
title: Файловые API исполнителя для проводника CC/Codex и статуса логина
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# Файловые API исполнителя для проводника CC/Codex и статуса логина

## Что сделано

- Обновлены KB-темы по LLM, деплою, backend internals и эксплуатации под новый срез, где профили CLI живут только внутри исполнителя, а сервер читает CC/Codex, login-status и картинки через HTTP-клиент `RunnerFsClient`.
- Дополнена feature-статья `features/llm-runners.md`: у исполнителя теперь есть не только `/v1/run`, но и `/v1/auth/status`, `/v1/files/read`, `/v1/fs/cc/*`, `/v1/fs/cx/*` и SSE-watch для tail.

## Что выяснили (факты, которых не было в KB)

- `apps/server/src/routes/rest.ts` сохраняет наружу старые формы `/api/auth/status`, `/api/cc/*`, `/api/cx/*` и `/api/files/read`, но в remote-режиме проксирует их в executor FS/auth API; локальное чтение диска сервера остаётся только fallback без настроенного executor URL.
- `apps/server/src/session.ts` больше не привязан к локальному `fs.watch`: при наличии `observerTail` от `buildServer()` live-tail идёт через SSE `watchCc/watchCx`, а `RunnerFsClient` переподключается с `Last-Event-ID`, используя смещение файла как id события.
- `apps/server/src/imageRelocate.ts` и `apps/server/src/turns.ts` больше не работают от списка локальных roots: перенос картинок опирается на абстракцию `readServerFile()`, поэтому байты могут приходить из профиля пользователя на исполнителе.
- `apps/llm-runner/src/fsApi.test.ts` и `apps/server/src/llm/runnerFsClient.test.ts` теперь покрывают не только модельный ран, но и файлово-auth контракты исполнителя, включая replay tail после reconnect.

## Куда занесено

- `docs/kb/llm.md`
- `docs/kb/features/llm-runners.md`
- `docs/kb/deploy.md`
- `docs/kb/server-internals.md`
- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Реестр исполнителей и UI-выбор runner-а по-прежнему остаются отдельным срезом: сейчас сервер знает только адреса из env (`VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL`).

---
title: RemoteLlmClient на сервере
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# RemoteLlmClient на сервере

## Что сделано

- Актуализированы темы `architecture`, `llm` и `server-internals` под новый срез, где сервер умеет ходить к LLM-исполнителю по HTTP через `RemoteLlmClient`, а локальный `spawn` остаётся фолбэком.
- В индекс KB занесена свежая сверка этих тем; журнал пополнен записью об изменении транспорта LLM.

## Что выяснили (факты, которых не было в KB)

- Выбор транспорта `claude`/`codex` теперь делается в `buildServer()` по env `VC_LLM_RUNNER_URL`, `VC_LLM_RUNNER_CLAUDE_URL`, `VC_LLM_RUNNER_CODEX_URL`, `VC_LLM_RUNNER_TOKEN`, `VC_LLM_RUNNER_TIMEOUT_MS`.
- `RemoteLlmClient` не разбирает вывод модели сам: он читает NDJSON `/v1/run` и отдаёт строки в общий приёмник `apps/server/src/llm/sinks.ts`, которым пользуются и локальные CLI-клиенты.
- Отмена удалённого хода адресуется серверным `runId`: `DELETE /v1/run/:id` отправляет исполнителю команду убить свой CLI, после чего сервер рвёт собственный поток чтения.
- Ошибки транспорта переводятся в пользовательские сообщения того же уровня, что и ошибки локального `spawn`; сетевой стек наружу не показывается.

## Куда занесено

- `docs/kb/architecture.md`
- `docs/kb/llm.md`
- `docs/kb/server-internals.md`
- `docs/kb/README.md`

## Открытые вопросы / что осталось

- Реестра исполнителей ещё нет: текущий срез всё ещё работает только с адресами исполнителя из env, но вложения уже передаются байтами в `LlmRequest.attachments`, пути в prompt переписываются на стороне runner, а проверка `cwd` перенесена к исполнителю.

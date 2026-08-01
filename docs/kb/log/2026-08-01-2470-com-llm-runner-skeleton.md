---
title: Каркас исполнителя LLM — apps/llm-runner и POST /v1/run
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# Каркас исполнителя LLM — apps/llm-runner и POST /v1/run

## Что сделано

- Новый воркспейс `apps/llm-runner` (Fastify, tsx, ESM): `POST /v1/run` (NDJSON),
  `DELETE /v1/run/:id`, `GET /v1/health`, Bearer на весь `/v1/*`, таймаут-сирота.
- Перенесены вместе с тестами: `claudeCli.ts`, `codexCli.ts`, `childKill.ts`,
  `mcp.ts`, `cliProfiles.ts`. Из CLI-классов вынесены `claudeArgs` и
  `codexInvocation` — сборка argv одна на класс и на сырой ран.
- Контракт `LlmRequest`/`LlmClient` + протокол исполнителя v1 переехали в
  `packages/shared/src/llm.ts`; `apps/server/src/claude/types.ts` — реэкспорт.
  `kbToolHint` ушёл в `packages/shared/src/kb.ts`.

## Что выяснили (факты, которых не было в KB)

- Срез 1 нельзя сделать «чистым переносом»: сервер обязан продолжать работать, а
  `RemoteLlmClient` появляется только в срезе 2. Поэтому `@voicechat/server`
  временно зависит от `@voicechat/llm-runner/cli` — это единственная альтернатива
  двум расходящимся копиям argv-сборки.
- Fastify-ответ для стрима не годится: нужен `reply.hijack()` + сырой
  `ServerResponse`. Без `res.flushHeaders()` Node держит заголовки до первого
  чанка, и клиент не узнаёт `x-run-id`, пока модель думает.
- «Клиент жив, но не читает» ловится только по возврату `false` из `res.write()`
  и отсутствию `drain` — отсюда абстракция `RunSink` (тест на сироту без сокета).
- Ран удаляется из реестра сразу по `close` процесса, а не после дренажа stdout:
  иначе отмена уже мёртвого рана возвращала бы `stopped:true`.

## Куда занесено

- docs/kb/features/llm-runners.md (новая статья), docs/kb/llm.md, docs/kb/shared.md
- apps/llm-runner/AGENTS.md, apps/server/AGENTS.md, корневой AGENTS.md

## Открытые вопросы / что осталось

- Срез 2: `RemoteLlmClient` на сервере и снятие прямого импорта CLI.
- Срез 8: сервисы `runner-work`/`runner-personal` в compose, тома авторизации.

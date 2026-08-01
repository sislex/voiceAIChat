---
title: Сверка KB после выноса CLI в apps/llm-runner
date: 2026-08-01
machine: 2470-com
author: alexeyrozhnov
---

# Сверка KB после выноса CLI в apps/llm-runner

Догоняющая правка к [каркасу исполнителя](2026-08-01-2470-com-llm-runner-skeleton.md):
сама статья `features/llm-runners.md` и `llm.md`/`shared.md` были написаны вместе с
кодом, а сквозные темы (карта процессов, конвенции, гейт, backend изнутри) всё ещё
описывали мир, где `spawn` CLI живёт в сервере.

## Что сделано

- `architecture.md` — в схеме помечено, что код запуска CLI лежит в `apps/llm-runner`;
  добавлен абзац «спавн выделен в отдельный воркспейс» с оговоркой, что сервер пока
  спавнит сам, импортируя классы из `@voicechat/llm-runner/cli`.
- `server-internals.md` — поправлены два устаревших факта: путь профилей CLI
  (`dataDir/cli-users/<base64url(логин)>`, модуль переехал в `apps/llm-runner/src/cli/`)
  и место, где живут `ClaudeCli`/`CodexCli` (контракт `LlmClient` — в `@voicechat/shared`).
- `conventions.md` — правило «относительные импорты с `.js`» теперь и про `apps/llm-runner`.
- `testing-operations.md` — новый воркспейс в списке корневого `npm install`, строка в
  матрице гейтов, абзац про то, как тестируется исполнитель.
- `protocol.md` — указатель: протокол сервер↔исполнитель не здесь, а в
  `packages/shared/src/llm.ts`.
- Свежесть проставлена (`kb.mjs touch`) темам, устаревшим именно из-за этого среза.

## Что выяснили (факты, которых не было в KB)

- `architecture.md` и `server-internals.md` остаются помечены устаревшими намеренно:
  за ними накопились 31 и 56 коммитов, и `touch` после точечной правки соврал бы, что
  тему сверили с кодом целиком.
- В тестах исполнителя Bearer обязан быть ASCII: значение заголовка — ByteString, и
  `fetch` с кириллическим токеном падает ещё до запроса (коммит 9306637). Разбор
  UTF-8 токенов проверяется на самом `tokenMatches`.
- Поток `/v1/run` нельзя проверить через `app.inject()`: он отдаёт тело целиком, то
  есть не отличит построчную выдачу от буферизованной. Отсюда реальный `listen()`
  плюс построчное чтение `fetch` в `server.test.ts`.

## Куда занесено

- docs/kb/architecture.md, server-internals.md, conventions.md, testing-operations.md,
  protocol.md; свежесть — llm.md, shared.md, features/llm-runners.md,
  features/ci-runner.md, features/kb-usage.md.
- Статьи «Разработка проекта»: монорепо/путь фичи (карта воркспейсов и гейт).

## Открытые вопросы / что осталось

- Срез 2 (`RemoteLlmClient` по HTTP) снимет зависимость `@voicechat/server` →
  `@voicechat/llm-runner`: после него править `architecture.md`, `llm.md` и
  `features/llm-runners.md` заново.
- Срез 8 (сервисы `runner-work`/`runner-personal` в compose) потребует правки
  `deploy.md`: сейчас у исполнителя compose-сервиса нет.

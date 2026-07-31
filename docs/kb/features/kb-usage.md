---
id: kb-usage
title: Использование базы знаний (телеметрия и панель)
kind: feature
updated: 2026-07-31
checked: 46a3f94
areas:
  - apps/server/src/kb/usage.ts
  - apps/server/src/kb/kbMcp.ts
  - apps/server/src/kb/routes.ts
  - apps/server/src/turns.ts
  - apps/server/src/db/schema.ts
  - packages/shared/src/kb.ts
  - packages/ui/src/components/kb
  - packages/ui/src/lib/kbUsage.ts
symbols:
  - createKbUsageTracker
  - registerKbMcp
  - kbToolBroker
  - sectionOf
  - kbToolHint
  - addKbUsage
  - kbUsageReport
  - kbUsageProjectReport
  - buildKbUsageFromMessages
  - KbUsagePanel
protocols:
  - GET /api/conversations/:id/kb-usage
  - GET /api/projects/:id/kb-usage
  - kb.usage
tags:
  - documentation
  - telemetry
  - mcp
  - agents
aliases:
  - использование БЗ
  - телеметрия базы знаний
  - kb usage
packages:
  - shared
  - server
  - ui
related:
  - project-knowledge-base
  - kb-workflow
  - llm
  - protocol
  - ui
  - data-auth
---

# Использование базы знаний (телеметрия и панель)

## Назначение

В тулбаре каждого чата есть кнопка «Использование БЗ» (📚) со счётчиком обращений. Панель показывает, какие разделы базы знаний получила модель, сколько раз, сколько это дало символов и токенов (оценка), а также агрегат по всем чатам проекта. Считается только то, что видела модель: авто-инъекция контекста сервером и вызовы инструментов `mcp__kb__*`. Ручной поиск человека на странице «База знаний» в телеметрию не попадает — иначе метрика «сколько раз модель обращалась» врала бы.

## Два источника обращений

`auto` — сервер подмешивает контекст в промпт хода (`turns.ts`, режим разговора `kbContextMode='auto'`). `tool_search` / `tool_document` / `tool_topics` — модель сама вызвала инструмент MCP-сервера `kb`. Без инструментов метрика «сколько раз модель запросила БЗ» невозможна в принципе, поэтому они появились вместе с панелью.

## Режимы `kbContextMode`

`auto` — авто-инъекция ДА, инструменты ДА, системный хинт «БЗ в первую очередь» плюс уже вставленный блок контекста. `manual` — авто-инъекции НЕТ, инструменты ДА, хинт усиленный (инструменты — единственный путь к базе). `off` — ничего. До этой фичи `manual` был эквивалентен `off`: `turns.ts` проверял только `'auto'`. Комбинация `manual` + `VC_KB_TOOL=off` вырождается в `off`, и панель показывает это чипом «инструмент БЗ отключён администратором».

## Инструменты модели (`kb/kbMcp.ts`)

Stateless MCP-эндпоинт `/mcp/kb`: доступ по секрету процесса `?k=`, ход адресуется токеном `?turn=` через in-memory `kbToolBroker`. Токен выдаёт `TurnManager` и снимает во всех выходах хода (готово, ошибка, отмена, `flushInterrupted`) — иначе каждый отменённый ход оставлял бы живой токен. `mcp__kb__document` режет раздел чистой функцией `sectionOf` и обрезает его на 8000 символах: без капа один вызов вливает в контекст всю базу.

Claude получает `--mcp-config` с сервером `kb` и общий `--append-system-prompt` (у CLI он один — хинты remote/БЗ склеиваются). `--allowedTools` в ходе БЕЗ машины намеренно НЕ передаётся: в headless `-p` этот флаг работает как allow-list автоодобрения, и добавление его ради БЗ выключило бы автоодобрение встроенных Read/Grep. Деградация безопасна — авто-инъекция в `auto` продолжает работать, а панель честно покажет 0 запросов модели; escape hatch — `VC_KB_TOOL_ALLOWLIST=1`. Codex получает `-c mcp_servers.kb.url=…` до ветвления plan/remote: база read-only, глушить её в плане незачем.

## Честность метрики токенов

Разложить `usage.inputTokens` хода на «сколько от БЗ» нельзя: CLI отдаёт суммарный вход промпта. Поэтому показываются три числа: точные СИМВОЛЫ отданного модели текста, оценка токенов `estimateKbTokens = ceil(chars/4)` (одна функция на сервер и UI, `packages/shared/src/kb.ts`) и доля от `promptChars` хода. В панели про оценку написано прямым текстом.

## Запись и реалтайм

`createKbUsageTracker` (`kb/usage.ts`) — единственная точка записи. `begin()` сразу рассылает кадр `kb.usage` со статусом `pending` (панель показывает «запрашивает…»), а строку в БД создаёт терминальный метод `complete/empty/fail` — один раз и уже финальной. `pending` в БД не хранится: не остаётся UPDATE-мусора и висящих обращений после падения процесса. Ни один метод трекера не выбрасывает: сбой БЗ или записи метрик не имеет права ронять ход (тест на это обязателен).

Кадры рассылаются по `userId`, как `claude.usage` — подписки нет. Гонку «REST-снапшот против инкремента» закрывает монотонный `seq` внутри разговора: клиент отбрасывает кадры с `seq ≤ lastSeq` и делает upsert по `query.id`.

## Хранение

`kb_usage_queries` (одно обращение) и `kb_usage_sections` (разделы обращения) — см. `apps/server/src/db/schema.ts`. `project_id` — снимок на момент обращения: чат может сменить проект. Итоги считаются ОТДЕЛЬНЫМ запросом без JOIN с разделами, иначе суммы размножаются по числу разделов; `prompt_chars` берётся по одному разу на `turn_id`, иначе доля БЗ в промпте занижается.

## UI

Кнопка — в `.mhead-right` компонента `ChatColumn` (число обращений в `aria-label`, счётчик-бейдж скрыт от скринридера, при активном обращении вместо него `Dots`). Панель — `packages/ui/src/components/kb/KbUsagePanel.tsx` (`ToolFrame variant='modal'`) с вкладками «Этот чат» / «По проекту», сводкой, таблицей разделов (сортировка через `aria-sort`, название раздела — кнопка) и лентой событий. Данные приходят пропсами; снапшот просит стор (`loadKbUsage`, `loadProjectKbUsage`), инкременты — `applyKbUsageQuery`.

Для чатов, живших до фичи (и для desktop без моста `window.kb`), отчёт собирает чистая функция `buildKbUsageFromMessages` из `meta.request.kbContext` сохранённых ходов. Склейка `mergeKbUsage` отбрасывает производное событие, если сервер этот ход уже посчитал (ключ — `messageId`), и вовсе не подмешивает историю, если серверная лента урезана лимитом: иначе двойной счёт.

Ссылка на раздел ведёт на `#/kb/:documentId` — `KnowledgeBase` открывает документ из адреса. Те же ссылки — в чипсах «База знаний» панели «Подробнее» ответа, где рядом стоят строки «Символы из БЗ» и «≈ токенов из БЗ».

## Изоляция

Отчёт по чату начинается с `getConversation(userId, id)` → `null` → 404; проектный — с приватного `isProjectMember` → 404. Кадры `kb.usage` уходят только своему пользователю (фильтр в `session.ts`).

## Тесты

Сервер: `db/database.kbUsage.test.ts` (монотонность `seq`, агрегаты, отсутствие дублирования сумм, каскад, изоляция), `kb/usage.test.ts` (pending с тем же id, трекер не выбрасывает при сломанной БД), `kb/kbMcp.test.ts` (403, `tools/list`, `deliveredChars === text.length`, кап, просроченный токен, `sectionOf`), `kb/usageRoutes.test.ts` (200/404, `lastSeq`), секции KB в `turns.test.ts`, форма аргументов в `claude/claudeCli.test.ts` и `codex/codexCli.test.ts`, маршрутизация кадра в `session.test.ts`. UI: `lib/kbUsage.test.ts`, `components/kb/KbUsagePanel.dom.test.tsx`, `store/voiceStore.kb.test.ts`, дополнения в `ChatColumn.dom.test.tsx`, `MessageMeta.dom.test.tsx`, `ConversationSettings.dom.test.tsx`, `App.commands.dom.test.tsx`, `App.pages.dom.test.tsx`, сториз `KbUsagePanel.stories.tsx`.

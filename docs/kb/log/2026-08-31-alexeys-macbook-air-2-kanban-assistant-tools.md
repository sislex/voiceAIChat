---
title: kanban-assistant-tools
date: 2026-08-31
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-assistant-tools

## Что сделано

- Канбан-ассистент переведён с JSON-envelope `propose.*` на инструменты в цикле:
  новый MCP-сервер `apps/server/src/mcp/kanbanMcp.ts` (чтение доски и проектного
  API, изменения карточек/колонок/настроек, запуск CI/QA/merge, поиск дубликатов,
  загрузка машин, тестовое окружение фичи, оркестрация, управление интерфейсом) —
  28 инструментов. Подключается к ходу панели ассистента: приватный чат
  `assistantKind: 'kanban'` или обычный чат проекта из её селектора (признак —
  присланный `assistantContext`).
- Ассистент видит, что открыто: `WidgetAssistantContext.surface` (маршрут, раздел,
  карточка, вкладка, вид доски, доступные команды палитры). Рамка
  `WidgetAssistantFrame` поднята на уровень `ProjectPage`, поэтому ассистент есть
  и в «Настройках», и в «Релизах».
- Мост в интерфейс: `WidgetUiRelay` + WS `widget.action`/`widget.result`,
  исполнение на клиенте — `packages/ui/src/lib/widgetUiActions.ts`.
- Автономия: колонка `conversations.assistant_autonomy`, тумблер «Автопилот» в
  шапке ассистента; необратимое наружу (настройки проекта, merge, старт плана)
  спрашивается всегда.
- Анти-дубликаты: `packages/shared/src/kanbanSimilarity.ts` + `taskPipelineState`
  (в т.ч. состояние «сделано, но не вмержено»); `kanban_task_create` блокирует
  дубликат до явного `acknowledgeSimilar`.
- Оркестрация: таблицы `assistant_orchestrations`/`assistant_orchestration_items`,
  фоновый `apps/server/src/orchestration/runManager.ts`, WS `assistant.orchestration`,
  панель прогресса в `KanbanAssistant`.

- Попутно: `apps/browser-runner` получил свой `vitest.config.ts` с
  `hookTimeout: 60_000` — его тест поднимает настоящий Chromium, и под полным
  гейтом хук стабильно падал по дефолтным 10 с (сам пакет проходит за 3 с).

## Что выяснили (факты, которых не было в KB)

- У Make и Консоли ассистент — это MCP-сервер на поверхность, а у канбана до сих
  пор был только эфемерный `assistantContext` + один `widget:query` на ход. Это и
  была вся разница «умеет / не умеет».
- `PreviewActionRelay` (`previewMcp.ts`) — готовый и единственный в кодовой базе
  паттерн «сервер просит браузер что-то сделать и ждёт ответ»; новый мост UI
  списан с него один в один, включая правило «ждём первый успех или все отказы».
- Реестр команд палитры (`lib/commands.ts`) — готовый список «кнопок, которые
  можно нажать»: `listCommands()` вызывается вне React, поэтому годится и для
  снимка экрана, и для исполнения `ui_run_command`.
- `pickCiRunAgent` и `db.countActiveCiRunsByAgent()` уже реализуют балансировку
  машин для параллельных CI-ранов; `db.listProjectMachines`/`getProject` отдают
  готовое поле `load`. Ассистенту оставалось только объяснить выбор словами.
- `db.createConversation` не принимает `'kanban'`: приватный чат ассистента
  создаётся отдельным `ensureKanbanAssistantConversation`.
- В планах шаг может наследовать задачу транзитивно (`create_task → run_ci →
  wait_merge`), поэтому проверка «у шага есть задача» обязана обходить цепочку
  зависимостей, а не только прямых родителей.
- Тик оркестратора обязан запускать шаги волнами: `create_task` завершается
  мгновенно, и зависящий `run_ci` должен стартовать в том же проходе — иначе
  каждый шаг плана стоил бы одного интервала таймера.

## Куда занесено

- docs/kb/features/kanban-assistant.md (новая статья)
- docs/kb/projects.md (раздел «Универсальный ассистент виджета» — что теперь запасной путь)
- docs/kb/llm.md (раздел «Канбан: инструменты `mcp__kanban__*`»)
- docs/kb/protocol.md (`widget.action`/`widget.result`, `assistant.orchestration`, новые REST и мосты)

## Открытые вопросы / что осталось

- Инструмента запуска нет у task preparation: ассистент видит её раны через
  `project_api_get`, но стартовать не умеет.
- Релизы ассистент только читает; `release_deploy` намеренно не заведён.
- Панель прогресса плана показывает только идущие планы и не даёт открыть ленту
  конкретного рана — ссылка на ран пока приходит текстом от модели.

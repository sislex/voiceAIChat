---
id: ci-runner
title: CI-раннер канбана (Авто-подготовка окружения для таска)
kind: feature
updated: 2026-07-29
areas:
  - packages/shared/src/ci.ts
  - apps/server/src/ci
  - apps/server/src/routes/ci.ts
  - apps/server/src/db/schema.ts
  - apps/server/src/db/database.ts
  - apps/server/src/agents/registry.ts
  - packages/ui/src/components/ci
  - packages/ui/src/remote/ciBridge.ts
  - packages/ui/src/store/voiceStore.ts
symbols:
  - createCiRunManager
  - AgentCommandExecutor
  - createCiModelHooks
  - registerCiCommandsMcp
  - CiRunManager
protocols:
  - ci-rest-v1
aliases:
  - CI
  - CI-раннер
  - воркфлоу задачи
  - выполнить
related:
  - feature-workflow
  - protocol
  - machines
  - llm
packages:
  - shared
  - server
  - ui
---

# CI-раннер канбана

Выполнение переиспользуемых серверных команд вокруг работы модели одной кнопкой
«Выполнить» на карточке задачи: команды слота **до** → работа модели → команды
слота **после** → резюме модели. Один **ран** с общим статусом, единой лентой,
потоковым логом, метриками длительности, fix-loop и диагностической консолью.
Заменяет собой пользовательский вход Feature Run (серверный код Feature Run
оставлен нетронутым, но из UI не вызывается).

## Модель данных

Таблицы `ci_*` в `db/schema.ts`: `ci_commands` (справочник, soft-delete,
версия текста), `ci_slot_commands` (привязка к слоту для проекта/задачи с
наследованием), `ci_runs`, `ci_run_steps` (kind: command/model_work/model_command/
model_summary, `parent_step_id` для вложенных вызовов), `ci_run_logs` (монотонный
`seq` для реплея после reconnect), `ci_fix_attempts`, `ci_workspaces`,
`ci_command_suggestions` (группировка по причине), `ci_events` (аудит), `ci_settings`
(единственная строка глобальных настроек). CI-поля проекта (`ci_base_branch`,
`ci_branch_template`, `ci_reuse_strategy`, `ci_exec_auth_ref`) добавляются в
`migrate()`. Доступ — по членству проекта; CI-админ = владелец проекта.

## Выполнение

`createCiRunManager` (`ci/runManager.ts`) — процесс-глобальный менеджер по образцу
`TurnManager`: последовательный прогон слот-за-слотом, очередь на проект + лимит
`maxConcurrentRuns` на сервер, отмена, откат Task в `prev_column_id` при Исходе B,
`is_cleanup`/`allow_failure`/таймаут. Команды выполняются на машине по умолчанию
проекта через `AgentCommandExecutor` (`ci/executor.ts`) поверх нового
`AgentRegistry.execStream` — потоковый форвард `exec.chunk` (агент не пересобирается);
cwd/env собираются с shell-escape (пользовательский ввод — только через env, не
конкатенацией). Секреты маскируются в логе.

## Модель в цикле

`createCiModelHooks` (`ci/modelHooks.ts`) на инъектируемом `LlmClient`: работа
модели (remote-bash MCP в рабочей папке), резюме, fix-loop (диагноз→правка→повтор
упавшего шага, лимиты `maxFixAttempts`/`fixTimeLimitMs`, предложения по правке
скрипта). Команды справочника доступны модели как MCP-инструмент `mcp__ci__run_command`
(`ci/ciCommandsMcp.ts`, брокер `ciToolBroker` по токену рана; лимит
`maxModelCommandCalls`, `is_cleanup` исключены). Каждый вызов — вложенный шаг ленты.

## Контракт и UI

Типы — `packages/shared/src/ci.ts`; REST-пути и WS-сообщения `ci.*` — в
`protocol.ts` (union'ы + `*_MESSAGE_TYPES`). Роуты — `routes/ci.ts`. Мост
`window.ci` (`remote/ciBridge.ts`), стор `ci*` + подписки. UI (`components/ci/`):
`CiCommands` (виджет-справочник + глобальные настройки + предложения + отчёт по
месту), `RunFeed` (лента рана + консоль), `CiTaskSettings`/`CiSlotEditor` (настройки
задачи), `CiProjectDefaults`, `CiConsole` (US-6, read-only/edit). Стиль — токены
`var(--…)` в `app.css`, без хардкода.

## Проверка

`apps/server/src/ci/*.test.ts` и `db/database.ci.test.ts` (25 тестов): пустые слоты,
падение слота «до» с откатом, `allow_failure`, `is_cleanup`, конкурентные раны,
fix-loop и исчерпание попыток, вызов команды моделью, консоль read-only. UI —
`components/ci/*.dom.test.tsx`. Гейт: `npm run -w @voicechat/server typecheck && test`;
UI — `typecheck` + `@voicechat/web build`.

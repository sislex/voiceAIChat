---
id: ci-runner
title: CI-раннер канбана (Авто-подготовка окружения для таска)
kind: feature
updated: 2026-07-30
checked: 2e2b231
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
  - clarifyBudget
  - CiInteraction
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
Заменил Feature Run полностью: UI, маршруты, координатор, контракт `features:*` и
таблицы `features`/`feature_events`/`agent_tasks`/`feature_deployments`/`repository_slots`
удалены (миграция сносит их при старте). Корень рабочих копий — `project_machines.repos_root`.

## Модель данных

Таблицы `ci_*` в `db/schema.ts`: `ci_commands` (справочник, soft-delete,
версия текста), `ci_slot_commands` (привязка к слоту для проекта/задачи с
наследованием), `ci_runs`, `ci_run_steps` (kind: command/model_work/model_command/
model_summary, `parent_step_id` для вложенных вызовов), `ci_run_logs` (монотонный
`seq` для реплея после reconnect; `ci_runs.llm_provider/llm_model` фиксируют выбор модели), `ci_fix_attempts`, `ci_workspaces`,
`ci_command_suggestions` (группировка по причине), `ci_events` (аудит), `ci_settings`
(единственная строка глобальных настроек). CI-поля проекта (`ci_base_branch`,
`ci_branch_template`, `ci_reuse_strategy`, `ci_exec_auth_ref`) добавляются в
`migrate()`. Доступ — по членству проекта; CI-админ = владелец проекта.

## Выполнение

`createCiRunManager` (`ci/runManager.ts`) — процесс-глобальный менеджер по образцу
`TurnManager`: последовательный прогон слот-за-слотом, очередь на проект + лимит
`maxConcurrentRuns` на сервер, отмена, откат Task в `prev_column_id` при Исходе B,
`is_cleanup`/`allow_failure`/таймаут. Exit code `66` означает dirty workspace: ран останавливается, UI требует явного подтверждения, затем `discardChangesAndRetry` выполняет `git reset --hard` + `git clean -fdx`, пишет аудит и запускает новый полный ран. Команды выполняются на машине по умолчанию
проекта через `AgentCommandExecutor` (`ci/executor.ts`) поверх нового
`AgentRegistry.execStream` — потоковый форвард `exec.chunk` (агент не пересобирается);
cwd/env собираются с shell-escape (пользовательский ввод — только через env, не
конкатенацией). Секреты маскируются в логе.

## Режим запуска и глубина уточнений

`CiLlmConfig` несёт не только `provider`/`model`, но и `mode` (`plan`|`development`),
`clarifyLevel` (`none`|`few`|`medium`|`detailed`) и `clarifyMax` (1..30, только для
`detailed`); бюджет вопросов считает `clarifyBudget()`. Наследование то же, что у
движка: задача → проект → `DEFAULT_CI_LLM_CONFIG` (`resolveTaskLlmConfig`), правится
в `CiTaskSettings` (под выбором модели) и `CiProjectDefaults`. Выбор снимком
фиксируется в `ci_runs.mode/clarify_level/clarify_max`, поэтому повтор рана его
сохраняет; `POST …/ci/run` принимает разовый `{ mode }`.

## Пауза рана: вопросы модели и одобрение плана

Один механизм на оба случая — таблица `ci_interactions` (`kind: clarify|plan_approval`)
и нетерминальный статус рана `awaiting_input`. Работа модели (`modelWork`) —
фазовый цикл ходов CLI в **одной сессии**: `runTurn` захватывает `onSession`, и
следующий ход идёт с `--resume`/`codex resume`. В режиме `plan` первый ход идёт с
`permissionMode: 'plan'`, затем гейт `askPlanApproval`: `approved` переводит тот же
диалог в `acceptEdits` (слот «после» и резюме идут как обычно), `rework` даёт
модели комментарий и новый план, отсутствие решения (таймаут/отмена) завершает ран
как `cancelled` без слота «после». Уточняющие вопросы разбираются существующим
`parseQuestions` из `@shared/questions` — нового формата нет.

Ожидание **отпускает серверный слот** (`releaseSlot`/`acquireSlot` вокруг await):
одобрение плана может длиться часами, а `maxConcurrentRuns` по умолчанию 2.
Очередь внутри проекта остаётся последовательной, как и была. Лимит ожидания —
`CiGlobalSettings.interactionWaitMs` (30 мин, `0` — без лимита); по таймауту
для `clarify` модель продолжает без уточнений, для гейта плана ран отменяется.

Вопрос дублируется в **связанный чат задачи** обычным AI-сообщением с блоком
```` ```questions ```` и меткой `TurnMeta.ciInteraction` — `ChatColumn` рисует его
готовым `QuestionsForm`, нового UI в чате нет. Ответить можно из ленты или из чата,
побеждает первый (`answerCiInteraction` обновляет строку только пока она `pending`,
повторный ответ — 409). Сервер дописывает ответ репликой в тот же чат.
REST — `POST /api/ci/runs/:runId/interactions/:id`, WS — `ci.interaction`,
`CiRunDetail.interactions` нужен для реплея после reload.

## Модель в цикле

`createCiModelHooks` (`ci/modelHooks.ts`) на инъектируемом `LlmClient`: работа
модели (remote-bash MCP в рабочей папке, многоходовый цикл с паузами, предел
`MAX_MODEL_TURNS`), резюме, fix-loop (диагноз→правка→повтор
упавшего шага, лимиты `maxFixAttempts`/`fixTimeLimitMs`, предложения по правке
скрипта). Команды справочника доступны модели как MCP-инструмент `mcp__ci__run_command`
Удалённый workspace передаётся только через `remote.mcpUrl`; его хостовый путь нельзя задавать как локальный `LlmRequest.cwd`, потому что CLI запускается внутри server-контейнера.
(`ci/ciCommandsMcp.ts`, брокер `ciToolBroker` по токену рана; лимит
`maxModelCommandCalls`, `is_cleanup` исключены). Каждый вызов — вложенный шаг ленты.
Ошибка `model_work` останавливает ран до after-слота и сохраняет workspace. В `RunFeed`
можно выбрать Claude/Codex и модель (включая «По умолчанию из codex», пустой id без `-m`), затем повторить с `model_work`; подготовительные
команды не запускаются повторно, выбранные provider/model сохраняются в ране и аудите.

## Контракт и UI

Типы — `packages/shared/src/ci.ts`; REST-пути и WS-сообщения `ci.*` — в
`protocol.ts` (union'ы + `*_MESSAGE_TYPES`). Роуты — `routes/ci.ts`. Мост
`window.ci` (`remote/ciBridge.ts`), стор `ci*` + подписки. UI (`components/ci/`):
`CiCommands` (виджет-справочник + глобальные настройки + предложения + отчёт по
месту), `RunFeed` (лента рана + консоль), `CiTaskSettings`/`CiSlotEditor` (настройки
задачи), `CiProjectDefaults`, `CiConsole` (US-6, read-only/edit). Стиль — токены
`var(--…)` в `app.css`, без хардкода.

## Проверка

`apps/server/src/ci/*.test.ts` (включая `interactions.test.ts`: пауза на вопрос,
409 на повторный ответ, бюджет уточнений, гейт плана approved/rework/отмена,
разовый оверрайд режима) и `db/database.ci.test.ts` (35+ тестов): пустые слоты,
падение слота «до» с откатом, `allow_failure`, `is_cleanup`, конкурентные раны,
fix-loop и исчерпание попыток, вызов команды моделью, консоль read-only. UI —
`components/ci/*.dom.test.tsx`. Гейт: `npm run -w @voicechat/server typecheck && test`;
UI — `typecheck` + `@voicechat/web build`.

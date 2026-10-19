<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-19 | ⚠ 3 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-18 | ⚠ 349 коммит(ов) в areas после сверки: bf4e22fab feat(shared-services): act for the turn user by core MCP token; reader routes and external MCP paths … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-16 | ⚠ 172 коммит(ов) в areas после сверки: 6943c705f chore(ui): pin Core UI 1.5.25 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 639 коммит(ов) в areas после сверки: 41f3997d0 fix(turns): refuse a claude.send message id that is not stored in the conversation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-19 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-19 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 1488 коммит(ов) в areas после сверки: d3bce4a94 Merge remote-tracking branch 'origin/dev' into codex/voice-optional … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e20 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 521 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-17 | ⚠ 1045 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 990 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 394 коммит(ов) в areas после сверки: bf4e22fab feat(shared-services): act for the turn user by core MCP token; reader routes and external MCP paths … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 494 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 789 коммит(ов) в areas после сверки: bf4e22fab feat(shared-services): act for the turn user by core MCP token; reader routes and external MCP paths … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-15 | ⚠ 910 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 923 коммит(ов) в areas после сверки: 0e8fa648c feat(shared-services): session-bound service RPC and per-turn MCP for external applications (deployment-profiles-v2 B17) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 2171 коммит(ов) в areas после сверки: fa8d59472 Reconcile voice deployment knowledge with published Make pin … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1088 коммит(ов) в areas после сверки: bf4e22fab feat(shared-services): act for the turn user by core MCP token; reader routes and external MCP paths … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 69 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-14 | ⚠ 1424 коммит(ов) в areas после сверки: d3bce4a94 Merge remote-tracking branch 'origin/dev' into codex/voice-optional … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 668 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-19, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-10 | ⚠ 69 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 124 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-14 | ⚠ код изменён 2026-10-19, сверка 2026-10-14 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-19 | ⚠ 2 коммит(ов) в areas после сверки: cb2ad5b0d fix(turns): ticket-delegated turns keep MCP tools instead of a tool-free run … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-19 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-18 | ⚠ 355 коммит(ов) в areas после сверки: d3bce4a94 Merge remote-tracking branch 'origin/dev' into codex/voice-optional … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1215. Последние:

- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-voice-optional.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-voice-optional.md) — voice-optional
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-turn-unknown-message-id.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-turn-unknown-message-id.md) — turn-unknown-message-id
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-service-rpc-mcp.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-service-rpc-mcp.md) — shared-service-rpc-mcp
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-service-mcp-authority.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-service-mcp-authority.md) — shared-service-mcp-authority
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-peers-any-range.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-peers-any-range.md) — shared-peers-any-range
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-optional-peers.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-optional-peers.md) — shared-optional-peers
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-release-train-set-version.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-release-train-set-version.md) — release-train-set-version
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-41.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-41.md) — pin-shared-0-1-41
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-40.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-40.md) — pin-shared-0-1-40
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-39.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-39.md) — pin-shared-0-1-39

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

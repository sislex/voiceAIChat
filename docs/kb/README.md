<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ⚠ 27 коммит(ов) в areas после сверки: d59f3b5f chore(make): pin make-contracts 1.6.0 (live stand ops and transfer links) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 23 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-08 | ⚠ 4 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-08 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 89 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 47 коммит(ов) в areas после сверки: a5456814 chat-history-v1 B02 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 289 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 433 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 60 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 18 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 73 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 34 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 35 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 34 коммит(ов) в areas после сверки: cce5064e docs(kb): touch server internals for history MCP … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 103 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-05, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 7 коммит(ов) в areas после сверки: 263b9c55 fix(release-gate): verified base from where the production release branch forked … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 112 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 46 коммит(ов) в areas после сверки: a5456814 chat-history-v1 B02 … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ⚠ 81 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 2 коммит(ов) в areas после сверки: 02cbb132 docs(kb): module ownership map (kb-service-v1 U02, partial) … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-08 | ⚠ 6 коммит(ов) в areas после сверки: 869b36ca feat(server): conversation history search MCP for the assistant (chat-history-v1 B04) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-08 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-08 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-08 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-08, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1122. Последние:

- [2026-10-08-pc-radvilovich-tailae39a6-ts-net-chat-history-mcp.md](log/2026-10-08-pc-radvilovich-tailae39a6-ts-net-chat-history-mcp.md) — chat-history-mcp
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-selected-readiness.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-selected-readiness.md) — release-train-selected-readiness
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-kb-separate-commit.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-kb-separate-commit.md) — release-train-kb-separate-commit
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-kb-after-bump.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-kb-after-bump.md) — release-train-kb-after-bump
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-f1f867f4-d2a8-4cd2-b9b1-5251f6e4b86b.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-f1f867f4-d2a8-4cd2-b9b1-5251f6e4b86b.md) — release-train-f1f867f4-d2a8-4cd2-b9b1-5251f6e4b86b
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-29.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-29.md) — pin-shared-0-1-29
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-28.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-28.md) — pin-shared-0-1-28
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-27.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-27.md) — pin-shared-0-1-27
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-multi-project-integration-tokens.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-multi-project-integration-tokens.md) — multi-project-integration-tokens
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-codex-lost-thread-fresh-start.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-codex-lost-thread-fresh-start.md) — codex-lost-thread-fresh-start

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

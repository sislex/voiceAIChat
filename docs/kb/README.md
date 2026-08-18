<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-18 | ⚠ 2 коммит(ов) в areas после сверки: e047ac1 Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-18 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-18 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 4 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-18 | ⚠ 1 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-18 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-17 | ⚠ 22 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ⚠ 11 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 28 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 60 коммит(ов) в areas после сверки: b56f1ca feat: add interactive task preparation attempts … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-17 | ⚠ 11 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 5 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-16 | ⚠ 32 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 425 коммит(ов) в areas после сверки: 8b24147 docs(kb): update after merge 2d5a0740-8ab9-4bc4-b3b5-0dfa8950457a … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-16 | ⚠ 30 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ код изменён 2026-08-18, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-18 | ⚠ 1 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 4 коммит(ов) в areas после сверки: e047ac1 Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-17 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-17 | ⚠ 11 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-18 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-17 | ⚠ 6 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-18 | ⚠ 2 коммит(ов) в areas после сверки: e047ac1 Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-18 | ⚠ 3 коммит(ов) в areas после сверки: c437cd4 fix(server): инициализировать newId/now до migrate() … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ код изменён 2026-08-18, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-18 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-18 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-18, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 259. Последние:

- [2026-08-18-mac-app-shell-chat-271.md](log/2026-08-18-mac-app-shell-chat-271.md) — app-shell-chat-271
- [2026-08-18-alexeys-macbook-air-2-task-preparation-brief.md](log/2026-08-18-alexeys-macbook-air-2-task-preparation-brief.md) — task-preparation-brief
- [2026-08-18-alexeys-macbook-air-2-migrate-newid-crash.md](log/2026-08-18-alexeys-macbook-air-2-migrate-newid-crash.md) — migrate-newid-crash
- [2026-08-18-alexeys-macbook-air-2-deploy-test-timeout.md](log/2026-08-18-alexeys-macbook-air-2-deploy-test-timeout.md) — deploy-test-timeout
- [2026-08-18-alexeys-macbook-air-2-admin-app-boundary.md](log/2026-08-18-alexeys-macbook-air-2-admin-app-boundary.md) — admin-app-boundary
- [2026-08-17-mac-task-timeline.md](log/2026-08-17-mac-task-timeline.md) — task-timeline
- [2026-08-17-mac-task-tabs-workflow-preview.md](log/2026-08-17-mac-task-tabs-workflow-preview.md) — task-tabs-workflow-preview
- [2026-08-17-mac-model-work-disclosure-git-transport.md](log/2026-08-17-mac-model-work-disclosure-git-transport.md) — model-work-disclosure-git-transport
- [2026-08-17-mac-merge-retry-machine.md](log/2026-08-17-mac-merge-retry-machine.md) — merge-retry-machine
- [2026-08-17-mac-kanban-stage-arrows.md](log/2026-08-17-mac-kanban-stage-arrows.md) — kanban-stage-arrows

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

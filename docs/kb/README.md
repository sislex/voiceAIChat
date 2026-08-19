<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 2 коммит(ов) в areas после сверки: 00ce915f fix(ui): preserve context settings subroutes … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-19 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-18 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 7 коммит(ов) в areas после сверки: 3fb7094d CHAT-292 add durable automation runner foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-18 | ⚠ 17 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-18 | ⚠ 11 коммит(ов) в areas после сверки: 3fb7094d CHAT-292 add durable automation runner foundation … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-20 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ⚠ 24 коммит(ов) в areas после сверки: 3fb7094d CHAT-292 add durable automation runner foundation … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 47 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 2 коммит(ов) в areas после сверки: 689f8d92 feat: split task and chat machine defaults … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-17 | ⚠ 33 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 29 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-19 | ⚠ 2 коммит(ов) в areas после сверки: 00ce915f fix(ui): preserve context settings subroutes … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 466 коммит(ов) в areas после сверки: 960940ae docs(kb): update after merge 91933054-7dd9-46f7-804d-cd5474c4f036 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-16 | ⚠ 51 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-18 | ⚠ код изменён 2026-08-20, сверка 2026-08-18 (по датам: правки того же дня не видны — поставь checked) |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-18 | ⚠ 14 коммит(ов) в areas после сверки: c9ed3cd3 CHAT-288 group sidebar history and backfill cancelled … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-19 | ⚠ 3 коммит(ов) в areas после сверки: d924c2e2 Merge task 4012d157-a344-4280-a63e-275ee1366338 … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 4 коммит(ов) в areas после сверки: e047ac1b Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-17 | ⚠ 5 коммит(ов) в areas после сверки: d924c2e2 Merge task 4012d157-a344-4280-a63e-275ee1366338 … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-19 | ⚠ 5 коммит(ов) в areas после сверки: 00ce915f fix(ui): preserve context settings subroutes … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 2 коммит(ов) в areas после сверки: 00ce915f fix(ui): preserve context settings subroutes … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-20 | ⚠ 1 коммит(ов) в areas после сверки: 00ce915f fix(ui): preserve context settings subroutes |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-19 | ⚠ 7 коммит(ов) в areas после сверки: d924c2e2 Merge task 4012d157-a344-4280-a63e-275ee1366338 … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-19 | ⚠ 9 коммит(ов) в areas после сверки: 3fb7094d CHAT-292 add durable automation runner foundation … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ код изменён 2026-08-20, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-19 | ⚠ 1 коммит(ов) в areas после сверки: 3fb7094d CHAT-292 add durable automation runner foundation |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-20 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-20, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 277. Последние:

- [2026-08-20-mac-context-inspector-routing.md](log/2026-08-20-mac-context-inspector-routing.md) — context-inspector-routing
- [2026-08-20-mac-cancelled-sidebar-history.md](log/2026-08-20-mac-cancelled-sidebar-history.md) — cancelled-sidebar-history
- [2026-08-20-mac-automation-runner.md](log/2026-08-20-mac-automation-runner.md) — automation-runner
- [2026-08-19-macbook-air-user-split-task-chat-default-machines.md](log/2026-08-19-macbook-air-user-split-task-chat-default-machines.md) — split-task-chat-default-machines
- [2026-08-19-macbook-air-user-run-feed-full-width.md](log/2026-08-19-macbook-air-user-run-feed-full-width.md) — run-feed-full-width
- [2026-08-19-macbook-air-user-machines-kanban-settings.md](log/2026-08-19-macbook-air-user-machines-kanban-settings.md) — machines-kanban-settings
- [2026-08-19-mac-local-image-retouch-kb.md](log/2026-08-19-mac-local-image-retouch-kb.md) — local-image-retouch-kb
- [2026-08-19-mac-frontend-quality-gates.md](log/2026-08-19-mac-frontend-quality-gates.md) — frontend-quality-gates
- [2026-08-19-mac-ci-execution-llm.md](log/2026-08-19-mac-ci-execution-llm.md) — ci-execution-llm
- [2026-08-19-2470-com-reader-module-boundaries.md](log/2026-08-19-2470-com-reader-module-boundaries.md) — reader-module-boundaries

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

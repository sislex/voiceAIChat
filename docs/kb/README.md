<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-18 | ⚠ 11 коммит(ов) в areas после сверки: 4b6fa2c0 test: enforce modular frontend quality gates … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-18 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 5 коммит(ов) в areas после сверки: 4b6fa2c0 test: enforce modular frontend quality gates … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-18 | ⚠ 11 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-18 | ⚠ 7 коммит(ов) в areas после сверки: 66d4da57 feat: add local AI image retouching … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-19 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ⚠ 19 коммит(ов) в areas после сверки: cb02110e CHAT-277 show actual CI stage model … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 43 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 1 коммит(ов) в areas после сверки: 66d4da57 feat: add local AI image retouching |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-17 | ⚠ 28 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 22 коммит(ов) в areas после сверки: 7ab4011e fix(ui): stretch task run feed tab … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-16 | ⚠ 42 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 453 коммит(ов) в areas после сверки: e1406d67 docs(kb): update after merge 60a1935d-f8aa-4bf0-8209-7dd33848b7b1 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-16 | ⚠ 46 коммит(ов) в areas после сверки: 7ab4011e fix(ui): stretch task run feed tab … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-18 | ⚠ код изменён 2026-08-19, сверка 2026-08-18 (по датам: правки того же дня не видны — поставь checked) |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-18 | ⚠ 9 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-19 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 4 коммит(ов) в areas после сверки: e047ac1b Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: 66d4da57 feat: add local AI image retouching … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-18 | ⚠ 3 коммит(ов) в areas после сверки: e76af0f2 Merge task e037f5cc-65d7-4a43-92ff-6ad4f77d6ae9 … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-18 | ⚠ 10 коммит(ов) в areas после сверки: 7ab4011e fix(ui): stretch task run feed tab … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-19 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-19 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ код изменён 2026-08-19, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-19 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-19 | ⚠ 3 коммит(ов) в areas после сверки: 8a1da1da test(ui): cover run feed responsive width … |
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

Всего записей: 271. Последние:

- [2026-08-19-macbook-air-user-run-feed-full-width.md](log/2026-08-19-macbook-air-user-run-feed-full-width.md) — run-feed-full-width
- [2026-08-19-mac-local-image-retouch-kb.md](log/2026-08-19-mac-local-image-retouch-kb.md) — local-image-retouch-kb
- [2026-08-19-mac-frontend-quality-gates.md](log/2026-08-19-mac-frontend-quality-gates.md) — frontend-quality-gates
- [2026-08-19-mac-ci-execution-llm.md](log/2026-08-19-mac-ci-execution-llm.md) — ci-execution-llm
- [2026-08-18-macbook-air-user-project-machines-settings.md](log/2026-08-18-macbook-air-user-project-machines-settings.md) — project-machines-settings
- [2026-08-18-macbook-air-user-project-machines-settings-kb.md](log/2026-08-18-macbook-air-user-project-machines-settings-kb.md) — project-machines-settings-kb
- [2026-08-18-macbook-air-user-chat-273-latest-run-failure.md](log/2026-08-18-macbook-air-user-chat-273-latest-run-failure.md) — chat-273-latest-run-failure
- [2026-08-18-mac-remote-image-files.md](log/2026-08-18-mac-remote-image-files.md) — remote-image-files
- [2026-08-18-mac-projects.md](log/2026-08-18-mac-projects.md) — projects
- [2026-08-18-mac-latest-task-run-result-kb.md](log/2026-08-18-mac-latest-task-run-result-kb.md) — latest-task-run-result-kb

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

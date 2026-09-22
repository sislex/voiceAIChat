<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 4 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 73 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-11 | ⚠ 6 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-22 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-17 | ⚠ 20 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 7 коммит(ов) в areas после сверки: c1e8525b Enforce personal tenant tariffs across applications … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 14 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 219 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 375 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 22 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 11 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-16 | ⚠ 28 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-20 | ⚠ 7 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1597 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 52 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-22 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 18 коммит(ов) в areas после сверки: c1e8525b Enforce personal tenant tariffs across applications … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 16 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 384 коммит(ов) в areas после сверки: d819f3ee fix(identity): preserve remote admin session activity … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 36 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-22 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-16 | ⚠ 22 коммит(ов) в areas после сверки: 875dd6cc fix(admin): avoid repeated parsing in usage summaries … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 272 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-17 | ⚠ 6 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-17 | ⚠ 13 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-22 | ⚠ 2 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-20 | ⚠ 5 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 215 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 3 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-22 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 167 коммит(ов) в areas после сверки: 25755c3d refactor: consume owner UI libraries and isolate owner test gates … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-22 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-20, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 908. Последние:

- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-users-page-startup.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-users-page-startup.md) — users-page-startup
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-artifact-consumers.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-artifact-consumers.md) — owner-artifact-consumers
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-final-owner-test-migration.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-final-owner-test-migration.md) — final-owner-test-migration
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-extracted-test-ownership.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-extracted-test-ownership.md) — Extracted application test ownership
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-direct-library-dependencies.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-direct-library-dependencies.md) — direct-library-dependencies
- [2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-ws-bootstrap-delivery.md](log/2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-ws-bootstrap-delivery.md) — ws-bootstrap-delivery
- [2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-release-317-verification.md](log/2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-release-317-verification.md) — release-317-verification
- [2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-identity-admin-activity-rpc.md](log/2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-identity-admin-activity-rpc.md) — identity-admin-activity-rpc
- [2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-chat-execution-accounting.md](log/2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-chat-execution-accounting.md) — chat-execution-accounting
- [2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-chat-accounting-production.md](log/2026-09-21-alexeys-macbook-air-tailae39a6-ts-net-chat-accounting-production.md) — chat-accounting-production

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

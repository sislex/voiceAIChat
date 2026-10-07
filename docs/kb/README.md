<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-07 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-07 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ✓ |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ✓ |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-07 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-07 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-07 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-07 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-06 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-07 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1100. Последние:

- [2026-10-07-delivery-c01-kb-service-v3.md](log/2026-10-07-delivery-c01-kb-service-v3.md) — kb-service-v3
- [2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-task-gate-budget-300.md](log/2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-task-gate-budget-300.md) — task-gate-budget-300
- [2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-12.md](log/2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-12.md) — pin-kanban-0-2-12
- [2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-kanban-stand-cache-prune.md](log/2026-10-07-alexeys-macbook-air-tailae39a6-ts-net-kanban-stand-cache-prune.md) — kanban-stand-cache-prune
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-task-gate-module-scope.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-task-gate-module-scope.md) — task-gate-module-scope
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-gate-speed-b01.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-gate-speed-b01.md) — release-gate-speed-b01
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-disk-preflight-b01.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-disk-preflight-b01.md) — release-disk-preflight-b01
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-25.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-25.md) — pin-shared-0-1-25
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-4-0.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-4-0.md) — pin-make-1-4-0
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-9.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-9.md) — pin-kanban-0-2-9

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

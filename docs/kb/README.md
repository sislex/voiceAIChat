<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-03 | ✓ |
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
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ✓ |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-29 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-30 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-28 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-03 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-30 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1010. Последние:

- [2026-10-03-pc-radvilovich-tailae39a6-ts-net-environments-v3-shared-contracts.md](log/2026-10-03-pc-radvilovich-tailae39a6-ts-net-environments-v3-shared-contracts.md) — environments-v3-shared-contracts
- [2026-10-03-delivery-c15-placement-aware-compose.md](log/2026-10-03-delivery-c15-placement-aware-compose.md) — placement-aware-compose
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-5.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-5.md) — pin-kanban-0.1.5
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-4.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-4.md) — pin-kanban-0.1.4
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-3-core-ui-1-4-14-desktop-1-0-17.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-3-core-ui-1-4-14-desktop-1-0-17.md) — pin-kanban-0.1.3-core-ui-1.4.14-desktop-1.0.17
- [2026-10-03-alexeys-macbook-air-2-pin-core-ui-1-4-13-desktop-1-0-16.md](log/2026-10-03-alexeys-macbook-air-2-pin-core-ui-1-4-13-desktop-1-0-16.md) — pin-core-ui-1.4.13-desktop-1.0.16
- [2026-10-03-alexeys-macbook-air-2-owner-pack-integrity-format.md](log/2026-10-03-alexeys-macbook-air-2-owner-pack-integrity-format.md) — owner-pack-integrity-format
- [2026-10-03-alexeys-macbook-air-2-environments-v2-storage.md](log/2026-10-03-alexeys-macbook-air-2-environments-v2-storage.md) — environments-v2-storage
- [2026-10-03-alexeys-macbook-air-2-environments-v2-shared.md](log/2026-10-03-alexeys-macbook-air-2-environments-v2-shared.md) — environments-v2-shared
- [2026-10-03-alexeys-macbook-air-2-c05-stand-machine-scripts.md](log/2026-10-03-alexeys-macbook-air-2-c05-stand-machine-scripts.md) — Stand machine lifecycle scripts

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

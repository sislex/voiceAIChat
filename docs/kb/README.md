<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-01 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-01 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-01 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-01 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-01 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-02 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-01 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-01 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-10-31 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-10-31 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-01 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-01 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-01 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-01 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-01 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-01 | ✓ |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-01 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-31 | ✓ |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-01 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-29 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-10-29 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-01 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-10-31 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-01 | ✓ |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-01 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-31 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-01 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-01 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-31 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-01 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-01 | ✓ |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-01 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-01 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-01 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-29 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-01 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-01 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-01 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/automation-runner](../../apps/automation-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/file-storage](../../packages/file-storage/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/knowledge](../../packages/knowledge/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1423. Последние:

- [2026-11-02-alexeys-macbook-air-tailae39a6-ts-net-core-identity-storage-oauth.md](log/2026-11-02-alexeys-macbook-air-tailae39a6-ts-net-core-identity-storage-oauth.md) — core-identity-storage-oauth
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-storage-transfer-compression.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-storage-transfer-compression.md) — storage-transfer-compression
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-834-dev-stand-test-isolation.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-834-dev-stand-test-isolation.md) — sisl-834-dev-stand-test-isolation
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-828-remote-storage-core.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-828-remote-storage-core.md) — sisl-828-remote-storage-core
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-827-storage-browser-entry.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-827-storage-browser-entry.md) — sisl-827-storage-browser-entry
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-818-storage-thumbnails.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-818-storage-thumbnails.md) — sisl-818-storage-thumbnails
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-816-storage-http-cache-range.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-sisl-816-storage-http-cache-range.md) — sisl-816-storage-http-cache-range
- [2026-11-01-pc-radvilovich-tailae39a6-ts-net-release-train-resume-core-refresh.md](log/2026-11-01-pc-radvilovich-tailae39a6-ts-net-release-train-resume-core-refresh.md) — release-train-resume-core-refresh
- [2026-11-01-alexeys-macbook-air-tailae39a6-ts-net-storage-streaming-pool.md](log/2026-11-01-alexeys-macbook-air-tailae39a6-ts-net-storage-streaming-pool.md) — storage-streaming-pool
- [2026-11-01-alexeys-macbook-air-tailae39a6-ts-net-storage-remote-kb-reconcile.md](log/2026-11-01-alexeys-macbook-air-tailae39a6-ts-net-storage-remote-kb-reconcile.md) — storage-remote-kb-reconcile

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

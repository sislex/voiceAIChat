<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-31 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-31 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-31 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-10-29 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: c64c2a4d feat(file-storage): add storage nodes and coordinator (FS-1) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-31 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-10-29 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-10-29 | ⚠ 1 коммит(ов) в areas после сверки: c64c2a4d feat(file-storage): add storage nodes and coordinator (FS-1) |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-10-31 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-10-31 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-31 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-29 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-30 | ✓ |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-10-31 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-29 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-10-29 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-31 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-10-29 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-31 | ✓ |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-29 | ⚠ 1 коммит(ов) в areas после сверки: c64c2a4d feat(file-storage): add storage nodes and coordinator (FS-1) |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-30 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-30 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-30 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-31 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-31 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-30 | ⚠ 2 коммит(ов) в areas после сверки: c64c2a4d feat(file-storage): add storage nodes and coordinator (FS-1) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-31 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-29 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-31 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-31 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-31 | ⚠ 1 коммит(ов) в areas после сверки: 2f1ff1a3 feat(shared): file storage service contract and plan |
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

Всего записей: 1372. Последние:

- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-sisl-785-mailpit-boundaries.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-sisl-785-mailpit-boundaries.md) — sisl-785-mailpit-boundaries
- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-production-frontend-pins.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-production-frontend-pins.md) — production-frontend-pins
- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-make-frontend-dev-commit.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-make-frontend-dev-commit.md) — make-frontend-dev-commit
- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-make-frontend-commit-kb-verification.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-make-frontend-commit-kb-verification.md) — make-frontend-commit-kb-verification
- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-fs1-gate-env-isolation.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-fs1-gate-env-isolation.md) — fs1-gate-env-isolation
- [2026-10-31-pc-radvilovich-tailae39a6-ts-net-fs-1-file-storage.md](log/2026-10-31-pc-radvilovich-tailae39a6-ts-net-fs-1-file-storage.md) — fs-1-file-storage
- [2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-e0dce216-35c4-4bbc-a8ff-5eb263aae7a7.md](log/2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-e0dce216-35c4-4bbc-a8ff-5eb263aae7a7.md) — release-train-e0dce216-35c4-4bbc-a8ff-5eb263aae7a7
- [2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-6a4f9587-adf7-4c41-bcbe-977f1b58a654.md](log/2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-6a4f9587-adf7-4c41-bcbe-977f1b58a654.md) — release-train-6a4f9587-adf7-4c41-bcbe-977f1b58a654
- [2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-0a23378c-2a9c-479f-bf55-87b7f59f3d2f.md](log/2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-release-train-0a23378c-2a9c-479f-bf55-87b7f59f3d2f.md) — release-train-0a23378c-2a9c-479f-bf55-87b7f59f3d2f
- [2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-owner-npm-pins-train-e0dce216.md](log/2026-10-31-alexeys-macbook-air-tailae39a6-ts-net-owner-npm-pins-train-e0dce216.md) — owner-npm-pins-train-e0dce216

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

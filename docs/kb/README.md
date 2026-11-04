<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-03 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-04 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-04 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-02 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-04 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-04 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-04 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-10-31 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-04 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-03 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-04 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 90b3f0976 fix(knowledge): honor CommonMark fences and avoid a duplicate rerank |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-03 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-03 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-03 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-03 | ✓ |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-04 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-04 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 90b3f0976 fix(knowledge): honor CommonMark fences and avoid a duplicate rerank |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-03 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-02 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-04 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-10-31 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-03 | ✓ |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-03 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-31 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-03 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-04 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-31 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-01 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-04 | ✓ |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-05 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-02 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-04 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-29 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-04 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-04 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-04 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-11-04 | ✓ |

## Инструкции по пакетам

- [apps/automation-runner](../../apps/automation-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/file-storage](../../packages/file-storage/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/knowledge](../../packages/knowledge/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1457. Последние:

- [2026-11-05-pc-radvilovich-tailae39a6-ts-net-sisl-877-make-project-scan-limits.md](log/2026-11-05-pc-radvilovich-tailae39a6-ts-net-sisl-877-make-project-scan-limits.md) — sisl-877-make-project-scan-limits
- [2026-11-05-pc-radvilovich-tailae39a6-ts-net-sis-l-875-make-large-monorepo-structure.md](log/2026-11-05-pc-radvilovich-tailae39a6-ts-net-sis-l-875-make-large-monorepo-structure.md) — sis-l-875-make-large-monorepo-structure
- [2026-11-04-pc-radvilovich-tailae39a6-ts-net-sisl-871-stand-git-operations.md](log/2026-11-04-pc-radvilovich-tailae39a6-ts-net-sisl-871-stand-git-operations.md) — sisl-871-stand-git-operations
- [2026-11-04-pc-radvilovich-tailae39a6-ts-net-sisl-869-account-settings-guidance.md](log/2026-11-04-pc-radvilovich-tailae39a6-ts-net-sisl-869-account-settings-guidance.md) — sisl-869-account-settings-guidance
- [2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-sisl-867-ephemeral-test-listeners.md](log/2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-sisl-867-ephemeral-test-listeners.md) — sisl-867-ephemeral-test-listeners
- [2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-release-train-88f3b8d7-adad-496a-8bf0-aa4eb0cad550.md](log/2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-release-train-88f3b8d7-adad-496a-8bf0-aa4eb0cad550.md) — release-train-88f3b8d7-adad-496a-8bf0-aa4eb0cad550
- [2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-8-13.md](log/2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-8-13.md) — pin-make-1-8-13
- [2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-owner-cf2fda81-machines.md](log/2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-owner-cf2fda81-machines.md) — owner-cf2fda81-machines
- [2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-owner-cf2fda81-knowledge-preview.md](log/2026-11-04-alexeys-macbook-air-tailae39a6-ts-net-owner-cf2fda81-knowledge-preview.md) — owner-cf2fda81-knowledge-preview
- [2026-11-03-pc-radvilovich-tailae39a6-ts-net-sisl-853-universal-search-repeat-race.md](log/2026-11-03-pc-radvilovich-tailae39a6-ts-net-sisl-853-universal-search-repeat-race.md) — sisl-853-universal-search-repeat-race

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

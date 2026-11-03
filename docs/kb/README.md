<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-03 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-03 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 355452a8 chore(ui): pin Core UI 1.5.41 |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-03 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 355452a8 chore(ui): pin Core UI 1.5.41 |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-02 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-03 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-03 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-03 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-10-31 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-10-31 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-03 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-03 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-03 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-03 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-03 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-03 | ✓ |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-01 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-31 | ✓ |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-03 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-02 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-03 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-10-31 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-03 | ✓ |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-03 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-31 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-03 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-02 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-31 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-01 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-03 | ✓ |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-03 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 903514a4 card-SISL-863 B01 |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-02 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-03 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-29 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-03 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-03 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-03 | ✓ |
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

Всего записей: 1448. Последние:

- [2026-11-03-pc-radvilovich-tailae39a6-ts-net-sisl-853-universal-search-repeat-race.md](log/2026-11-03-pc-radvilovich-tailae39a6-ts-net-sisl-853-universal-search-repeat-race.md) — sisl-853-universal-search-repeat-race
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-sisl-857-palette-shortcut-retry.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-sisl-857-palette-shortcut-retry.md) — sisl-857-palette-shortcut-retry
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-sisl-855-identity-bearer.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-sisl-855-identity-bearer.md) — sisl-855-identity-bearer
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-owner-reconcile.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-owner-reconcile.md) — release-train-owner-reconcile
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-d2736740-699f-436e-869f-a2b9ac2f38ed.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-d2736740-699f-436e-869f-a2b9ac2f38ed.md) — release-train-d2736740-699f-436e-869f-a2b9ac2f38ed
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-0c9ee327-ed7c-4056-9c5c-63426f7117f4.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-release-train-0c9ee327-ed7c-4056-9c5c-63426f7117f4.md) — release-train-0c9ee327-ed7c-4056-9c5c-63426f7117f4
- [2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-identity-rollout-findings.md](log/2026-11-03-alexeys-macbook-air-tailae39a6-ts-net-identity-rollout-findings.md) — identity-rollout-findings
- [2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-sessionless-storage-kb-verification.md](log/2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-sessionless-storage-kb-verification.md) — sm-47-sessionless-storage-kb-verification
- [2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-owner-kb-repair.md](log/2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-owner-kb-repair.md) — sm-47-owner-kb-repair
- [2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-merge-storage-admission.md](log/2026-11-02-pc-radvilovich-tailae39a6-ts-net-sm-47-merge-storage-admission.md) — sm-47-merge-storage-admission

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

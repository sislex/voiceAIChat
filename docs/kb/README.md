<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-24, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 3 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 4 коммит(ов) в areas после сверки: ff965ad3 chore(core): compose public chat with Core UI 1.5.28 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ код изменён 2026-10-20, сверка 2026-09-29 (по датам: правки того же дня не видны — поставь checked) |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-20 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-24 | ⚠ 2 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-24 | ✓ |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ код изменён 2026-10-15, сверка 2026-09-17 (по датам: правки того же дня не видны — поставь checked) |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ код изменён 2026-10-17, сверка 2026-09-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-17 | ⚠ код изменён 2026-10-24, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ код изменён 2026-10-24, сверка 2026-08-28 (по датам: правки того же дня не видны — поставь checked) |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ код изменён 2026-10-24, сверка 2026-09-12 (по датам: правки того же дня не видны — поставь checked) |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ код изменён 2026-10-24, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ код изменён 2026-10-24, сверка 2026-09-17 (по датам: правки того же дня не видны — поставь checked) |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-15 | ⚠ код изменён 2026-10-24, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 14 коммит(ов) в areas после сверки: 2c59534a docs(kb): update after merge 66f3c5fe-22a5-4670-9865-9869bc311bbf … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ код изменён 2026-10-24, сверка 2026-09-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ код изменён 2026-10-18, сверка 2026-09-30 (по датам: правки того же дня не видны — поставь checked) |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 8 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ код изменён 2026-10-20, сверка 2026-09-16 (по датам: правки того же дня не видны — поставь checked) |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-24, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 592879f3 Document isolated public chat release and sislexa naming |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ код изменён 2026-10-20, сверка 2026-10-05 (по датам: правки того же дня не видны — поставь checked) |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-24 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-20 | ⚠ 3 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification … |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-20 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-22 | ⚠ 3 коммит(ов) в areas после сверки: 985b9e55 feat(mcp): add scoped historical journal verification … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-22 | ⚠ 2 коммит(ов) в areas после сверки: 082bf548 chore: pin Kanban 0.2.36 (SK-69: bounded cleanup registry, lock released during machine I/O) … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1254. Последние:

- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-775-owner-history.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-775-owner-history.md) — sisl-775-owner-history
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence.md) — scoped-historical-evidence
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence-kb.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence-kb.md) — scoped-historical-evidence-kb
- [2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-36.md](log/2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-36.md) — pin-kanban-0-2-36
- [2026-10-22-pc-radvilovich-tailae39a6-ts-net-remote-owner-roots.md](log/2026-10-22-pc-radvilovich-tailae39a6-ts-net-remote-owner-roots.md) — remote-owner-roots
- [2026-10-22-pc-radvilovich-tailae39a6-ts-net-remote-owner-roots-kb.md](log/2026-10-22-pc-radvilovich-tailae39a6-ts-net-remote-owner-roots-kb.md) — remote-owner-roots-kb
- [2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-35.md](log/2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-35.md) — pin-kanban-0-2-35
- [2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-34.md](log/2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-34.md) — pin-kanban-0-2-34
- [2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-exec-stream-keepalive.md](log/2026-10-22-alexeys-macbook-air-tailae39a6-ts-net-exec-stream-keepalive.md) — exec-stream-keepalive
- [2026-10-20-alexeys-macbook-air-tailae39a6-ts-net-sislexa-current-knowledge-branding.md](log/2026-10-20-alexeys-macbook-air-tailae39a6-ts-net-sislexa-current-knowledge-branding.md) — sislexa current knowledge branding

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

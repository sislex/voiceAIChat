<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-09 | ⚠ 2 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ⚠ 33 коммит(ов) в areas после сверки: 7831675c chore(release): pin Make 1.4.5 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 25 коммит(ов) в areas после сверки: ef78122b make-stand-v1 B02 … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-08 | ⚠ 5 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-09 | ⚠ 4 коммит(ов) в areas после сверки: 7831675c chore(release): pin Make 1.4.5 … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 96 коммит(ов) в areas после сверки: 7831675c chore(release): pin Make 1.4.5 … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 50 коммит(ов) в areas после сверки: ef78122b make-stand-v1 B02 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 292 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 436 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 62 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 21 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 76 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 37 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 36 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 48 коммит(ов) в areas после сверки: ff372140 docs(kb): log the offline-machine stand fix … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 106 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-05, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 7 коммит(ов) в areas после сверки: 263b9c55 fix(release-gate): verified base from where the production release branch forked … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 118 коммит(ов) в areas после сверки: 7831675c chore(release): pin Make 1.4.5 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 47 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ⚠ 84 коммит(ов) в areas после сверки: 9cf96f88 make-stand-v1 C01 … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 2 коммит(ов) в areas после сверки: 02cbb132 docs(kb): module ownership map (kb-service-v1 U02, partial) … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-08 | ⚠ 7 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-08 | ⚠ код изменён 2026-10-09, сверка 2026-10-08 (по датам: правки того же дня не видны — поставь checked) |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-09 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-08 | ⚠ 1 коммит(ов) в areas после сверки: ef78122b make-stand-v1 B02 |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-09, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1134. Последние:

- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-9-desktop-1-0-28.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-9-desktop-1-0-28.md) — pin-core-ui-1-5-9-desktop-1-0-28
- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-24-1.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-24-1.md) — pin-agent-0-24-1
- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-24-0.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-24-0.md) — pin-agent-0-24-0
- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-make-stand-offline-machines.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-make-stand-offline-machines.md) — make-stand-offline-machines
- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-make-stand-core.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-make-stand-core.md) — make-stand-core
- [2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-b02-stand-proxy.md](log/2026-10-09-alexeys-macbook-air-tailae39a6-ts-net-b02-stand-proxy.md) — Core dev stand session proxy (B02)
- [2026-10-08-pc-radvilovich-tailae39a6-ts-net-chat-history-mcp.md](log/2026-10-08-pc-radvilovich-tailae39a6-ts-net-chat-history-mcp.md) — chat-history-mcp
- [2026-10-08-pc-radvilovich-tailae39a6-ts-net-b01-thread-context-reset.md](log/2026-10-08-pc-radvilovich-tailae39a6-ts-net-b01-thread-context-reset.md) — b01-thread-context-reset
- [2026-10-08-delivery-b01-dev-stand-login.md](log/2026-10-08-delivery-b01-dev-stand-login.md) — dev-stand-login
- [2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-selected-readiness.md](log/2026-10-08-alexeys-macbook-air-tailae39a6-ts-net-release-train-selected-readiness.md) — release-train-selected-readiness

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

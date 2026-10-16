<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ⚠ код изменён 2026-10-16, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-09 | ⚠ 11 коммит(ов) в areas после сверки: 7dddeedc kanban-watch-v2 B01 … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-16 | ⚠ 2 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 28 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-08 | ⚠ 11 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-14 | ⚠ 12 коммит(ов) в areas после сверки: e44c73e6 chore(compose): pin Kanban 0.2.25 (Postgres schema fix for task engine tables) … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 137 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 13 коммит(ов) в areas после сверки: a189b2a3 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 55 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 305 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 446 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 71 коммит(ов) в areas после сверки: 7dddeedc kanban-watch-v2 B01 … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 2 коммит(ов) в areas после сверки: 7dddeedc kanban-watch-v2 B01 … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 89 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-15 | ⚠ 6 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 39 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 113 коммит(ов) в areas после сверки: ca267bc8 docs(kb): update after merge cbc93e7d-da5b-4e1e-bcfc-69c27d2a14ff … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 118 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-14, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 7 коммит(ов) в areas после сверки: 263b9c55 fix(release-gate): verified base from where the production release branch forked … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-14 | ⚠ 18 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 50 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-16, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-10 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-16, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 3 коммит(ов) в areas после сверки: 593220a9 docs(kb): glossary of roles, services, stands, delivery and technical terms … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-14, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-14 | ⚠ код изменён 2026-10-16, сверка 2026-10-14 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-16 | ⚠ 2 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-16 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-15 | ⚠ 7 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-16 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-16, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-16 | ⚠ 1 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-16, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-16, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1176. Последние:

- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-universal-search-synchronization.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-universal-search-synchronization.md) — universal-search-synchronization
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-universal-search-browser-synchronization.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-universal-search-browser-synchronization.md) — universal-search-browser-synchronization
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-33.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-33.md) — pin-shared-0-1-33
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-32.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-32.md) — pin-shared-0-1-32
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-31.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-31.md) — pin-shared-0-1-31
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-task-branches.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-task-branches.md) — kanban-task-branches
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-card-actions-execution-engine.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-card-actions-execution-engine.md) — kanban-card-actions-execution-engine
- [2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-board-cards-state.md](log/2026-10-16-alexeys-macbook-air-tailae39a6-ts-net-kanban-board-cards-state.md) — kanban-board-cards-state
- [2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-sisl-735-agent-downloads-brief.md](log/2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-sisl-735-agent-downloads-brief.md) — sisl-735-agent-downloads-brief
- [2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-merge-target-persistence.md](log/2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-merge-target-persistence.md) — merge-target-persistence

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

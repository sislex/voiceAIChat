<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 7 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: b4b59b3e perf(test): scope development gates and isolate parallel browser suites |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-22 | ⚠ 2 коммит(ов) в areas после сверки: 7d8ad812 refactor: extract Agent and Desktop into independent repositories … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: b4b59b3e perf(test): scope development gates and isolate parallel browser suites |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-17 | ⚠ 23 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 9 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 17 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 222 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 378 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 23 коммит(ов) в areas после сверки: 971afbce refactor: finish consuming extracted owner artifacts (#227) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 14 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-16 | ⚠ 31 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1606 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 54 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 21 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 19 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 387 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 41 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-22 | ⚠ 3 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ⚠ 2 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-17 | ⚠ 9 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-17 | ⚠ 16 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-20 | ⚠ 9 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 219 коммит(ов) в areas после сверки: b4b59b3e perf(test): scope development gates and isolate parallel browser suites … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-22 | ⚠ 1 коммит(ов) в areas после сверки: 31b38601 test: separate Core gates from owner system regressions |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 171 коммит(ов) в areas после сверки: b4b59b3e perf(test): scope development gates and isolate parallel browser suites … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-22 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 915. Последние:

- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-users-page-startup.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-users-page-startup.md) — users-page-startup
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-test-gate-timing-review.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-test-gate-timing-review.md) — test-gate-timing-review
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-extraction-production-acceptance.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-extraction-production-acceptance.md) — 2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-extraction-production-acceptance
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-artifact-consumers.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-owner-artifact-consumers.md) — owner-artifact-consumers
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-gate-optimization-after-extraction.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-gate-optimization-after-extraction.md) — gate-optimization-after-extraction
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-final-owner-test-migration.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-final-owner-test-migration.md) — final-owner-test-migration
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-extracted-test-ownership.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-extracted-test-ownership.md) — Extracted application test ownership
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-direct-library-dependencies.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-direct-library-dependencies.md) — direct-library-dependencies
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-core-ui-owner.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-core-ui-owner.md) — core-ui-owner
- [2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-browser-test-ownership.md](log/2026-09-22-alexeys-macbook-air-tailae39a6-ts-net-browser-test-ownership.md) — browser-test-ownership

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 11 коммит(ов) в areas после сверки: 5123d6dc feat(chat): add idempotent Make handoff … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 15 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-28 | ⚠ 3 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ⚠ 14 коммит(ов) в areas после сверки: 0710f2d9 fix(deploy): retain recent Core releases and prune after health … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-28 | ⚠ 2 коммит(ов) в areas после сверки: 5c1e8f61 feat(chat): complete external browser integration … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-28 | ⚠ 6 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 2 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 10 коммит(ов) в areas после сверки: 4c0bb6a9 feat(releases): manage browser UI from release center … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 18 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 242 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 393 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 37 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 30 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-16 | ⚠ 49 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 7 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1660 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 69 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 20 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 23 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 37 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 406 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-23 | ⚠ 1 коммит(ов) в areas после сверки: b63dfa0c feat(operations): add request correlation and recovery drills (#252) |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-22 | ⚠ 14 коммит(ов) в areas после сверки: 5c1e8f61 feat(chat): complete external browser integration … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ⚠ 18 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-23 | ⚠ 8 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-27 | ⚠ 4 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-28 | ⚠ 2 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-28 | ⚠ 2 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 235 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-27 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 187 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-28 | ⚠ 2 коммит(ов) в areas после сверки: fac5f047 Merge current Core main into E07 recovery … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 970. Последние:

- [2026-09-28-macbook-air-user-chat-device-sync.md](log/2026-09-28-macbook-air-user-chat-device-sync.md) — chat-device-sync
- [2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md) — s3-a07-owner-artifacts
- [2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md) — s3-a07-exact-composition
- [2026-09-28-alexeys-macbook-air-2-release-manager-source-images.md](log/2026-09-28-alexeys-macbook-air-2-release-manager-source-images.md) — release-manager-source-images
- [2026-09-28-alexeys-macbook-air-2-owner-workspace-handoff.md](log/2026-09-28-alexeys-macbook-air-2-owner-workspace-handoff.md) — owner-workspace-handoff
- [2026-09-28-alexeys-macbook-air-2-e07-browser-integration.md](log/2026-09-28-alexeys-macbook-air-2-e07-browser-integration.md) — E07 browser integration
- [2026-09-28-alexeys-macbook-air-2-core-release-retention.md](log/2026-09-28-alexeys-macbook-air-2-core-release-retention.md) — core-release-retention
- [2026-09-28-alexeys-macbook-air-2-chat-device-sync.md](log/2026-09-28-alexeys-macbook-air-2-chat-device-sync.md) — chat-device-sync
- [2026-09-28-alexeys-macbook-air-2-chat-device-sync-kb.md](log/2026-09-28-alexeys-macbook-air-2-chat-device-sync-kb.md) — chat-device-sync-kb
- [2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md](log/2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md) — a07-composition-blocker

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

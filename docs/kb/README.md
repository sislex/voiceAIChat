<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 11 коммит(ов) в areas после сверки: 5123d6dc feat(chat): add idempotent Make handoff … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 13 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-22 | ⚠ 13 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ⚠ 14 коммит(ов) в areas после сверки: 0710f2d9 fix(deploy): retain recent Core releases and prune after health … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-28 | ⚠ 1 коммит(ов) в areas после сверки: 412d60c4 Accept S3 A07 exact shared-chat composition |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-28 | ⚠ 4 коммит(ов) в areas после сверки: fb94d3d8 Merge remote-tracking branch 'origin/CHAT-498' into CHAT-498 … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-17 | ⚠ 41 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 10 коммит(ов) в areas после сверки: 4c0bb6a9 feat(releases): manage browser UI from release center … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 18 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 240 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 391 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 35 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 28 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-16 | ⚠ 47 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 7 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1657 коммит(ов) в areas после сверки: fb94d3d8 Merge remote-tracking branch 'origin/CHAT-498' into CHAT-498 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 67 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 18 коммит(ов) в areas после сверки: fb94d3d8 Merge remote-tracking branch 'origin/CHAT-498' into CHAT-498 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 23 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 35 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 404 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-23 | ⚠ 1 коммит(ов) в areas после сверки: b63dfa0c feat(operations): add request correlation and recovery drills (#252) |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-22 | ⚠ 13 коммит(ов) в areas после сверки: 412d60c4 Accept S3 A07 exact shared-chat composition … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ⚠ 16 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-23 | ⚠ 8 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-27 | ⚠ 2 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-28 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-28 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 233 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-27 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 185 коммит(ов) в areas после сверки: 493fcbf4 feat(chat): synchronize conversations across sessions … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-28 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 968. Последние:

- [2026-09-28-macbook-air-user-chat-device-sync.md](log/2026-09-28-macbook-air-user-chat-device-sync.md) — chat-device-sync
- [2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md) — s3-a07-owner-artifacts
- [2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md) — s3-a07-exact-composition
- [2026-09-28-alexeys-macbook-air-2-release-manager-source-images.md](log/2026-09-28-alexeys-macbook-air-2-release-manager-source-images.md) — release-manager-source-images
- [2026-09-28-alexeys-macbook-air-2-core-release-retention.md](log/2026-09-28-alexeys-macbook-air-2-core-release-retention.md) — core-release-retention
- [2026-09-28-alexeys-macbook-air-2-chat-device-sync.md](log/2026-09-28-alexeys-macbook-air-2-chat-device-sync.md) — chat-device-sync
- [2026-09-28-alexeys-macbook-air-2-chat-device-sync-kb.md](log/2026-09-28-alexeys-macbook-air-2-chat-device-sync-kb.md) — chat-device-sync-kb
- [2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md](log/2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md) — a07-composition-blocker
- [2026-09-28-a07-live-composition-admission.md](log/2026-09-28-a07-live-composition-admission.md) — 2026-09-28-a07-live-composition-admission
- [2026-09-27-delivery-c03-c03-chat-contracts.md](log/2026-09-27-delivery-c03-c03-chat-contracts.md) — c03-chat-contracts

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

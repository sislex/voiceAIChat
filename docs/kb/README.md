<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 11 коммит(ов) в areas после сверки: 5123d6dc feat(chat): add idempotent Make handoff … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 11 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-22 | ⚠ 11 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ⚠ 11 коммит(ов) в areas после сверки: 79d9f8d0 Pin S3 A05 and A06 owner artifacts for A07 composition … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-28 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-27 | ⚠ 6 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-17 | ⚠ 37 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 10 коммит(ов) в areas после сверки: 4c0bb6a9 feat(releases): manage browser UI from release center … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 18 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 238 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 389 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 33 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 26 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-16 | ⚠ 43 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 6 коммит(ов) в areas после сверки: ed6a73f2 Persist canonical chat settings across Core hosts … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1651 коммит(ов) в areas после сверки: 79d9f8d0 Pin S3 A05 and A06 owner artifacts for A07 composition … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 65 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 12 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 23 коммит(ов) в areas после сверки: 8f744434 feat: scope projects and chats to team tenants (#245) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 33 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 402 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-23 | ⚠ 1 коммит(ов) в areas после сверки: b63dfa0c feat(operations): add request correlation and recovery drills (#252) |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-22 | ⚠ 12 коммит(ов) в areas после сверки: 75422e3f Enable standalone delegated paid chat turns … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ⚠ 14 коммит(ов) в areas после сверки: 75422e3f Enable standalone delegated paid chat turns … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-23 | ⚠ 6 коммит(ов) в areas после сверки: 75422e3f Enable standalone delegated paid chat turns … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-27 | ⚠ 1 коммит(ов) в areas после сверки: 93a5005b Checkpoint standalone delegated chat admission and scoped transport |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-23 | ⚠ 11 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-22 | ⚠ 10 коммит(ов) в areas после сверки: 93a5005b Checkpoint standalone delegated chat admission and scoped transport … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 231 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-27 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 183 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-22 | ⚠ 13 коммит(ов) в areas после сверки: fc8074fd Checkpoint A07 delegated composition preflight and registry tests … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 963. Последние:

- [2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-owner-artifacts.md) — s3-a07-owner-artifacts
- [2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md](log/2026-09-28-alexeys-macbook-air-2-s3-a07-exact-composition.md) — s3-a07-exact-composition
- [2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md](log/2026-09-28-alexeys-macbook-air-2-a07-composition-blocker.md) — a07-composition-blocker
- [2026-09-28-a07-live-composition-admission.md](log/2026-09-28-a07-live-composition-admission.md) — 2026-09-28-a07-live-composition-admission
- [2026-09-27-delivery-c03-c03-chat-contracts.md](log/2026-09-27-delivery-c03-c03-chat-contracts.md) — c03-chat-contracts
- [2026-09-27-alexeys-macbook-air-2-u10-final-artifact-acceptance.md](log/2026-09-27-alexeys-macbook-air-2-u10-final-artifact-acceptance.md) — u10-final-artifact-acceptance
- [2026-09-27-alexeys-macbook-air-2-u10-exact-artifacts.md](log/2026-09-27-alexeys-macbook-air-2-u10-exact-artifacts.md) — u10-exact-artifacts
- [2026-09-27-alexeys-macbook-air-2-u02-canonical-chat-settings.md](log/2026-09-27-alexeys-macbook-air-2-u02-canonical-chat-settings.md) — u02-canonical-chat-settings
- [2026-09-27-alexeys-macbook-air-2-s3-provider-source-pins.md](log/2026-09-27-alexeys-macbook-air-2-s3-provider-source-pins.md) — s3-provider-source-pins
- [2026-09-27-alexeys-macbook-air-2-s3-delegated-chat-adapter.md](log/2026-09-27-alexeys-macbook-air-2-s3-delegated-chat-adapter.md) — s3-delegated-chat-adapter

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

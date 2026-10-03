<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 18 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 28 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ⚠ 36 коммит(ов) в areas после сверки: 1c810f43 fix(deps): force pinned agent-contracts for exact 1.0.0 peers … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 10 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ⚠ 3 коммит(ов) в areas после сверки: c70d5ca1 feat(deploy): production snapshot and stand restore (environments-v3 C16) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-03 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 39 коммит(ов) в areas после сверки: aa6b503c chore: pin environments-v3 releases (Kanban 0.1.6, Core UI 1.4.15, Desktop 1.0.18, agent 0.21.0) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 33 коммит(ов) в areas после сверки: 92a092a2 fix(server): relay agent tunnel backpressure frames … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 264 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 414 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 47 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 2 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 49 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 10 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 22 коммит(ов) в areas после сверки: a70fe2cd feat(server): environments-v2 storage (B03) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1738 коммит(ов) в areas после сверки: 1c810f43 fix(deps): force pinned agent-contracts for exact 1.0.0 peers … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 85 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 3 коммит(ов) в areas после сверки: 539581e9 fix(gate): lead full-plan reasons with the changed Core code … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 64 коммит(ов) в areas после сверки: aa6b503c chore: pin environments-v3 releases (Kanban 0.1.6, Core UI 1.4.15, Desktop 1.0.18, agent 0.21.0) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 38 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 58 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 423 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-29 | ⚠ 2 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ⚠ 3 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-03 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ⚠ 9 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-30 | ⚠ 4 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-03 | ⚠ 4 коммит(ов) в areas после сверки: c70d5ca1 feat(deploy): production snapshot and stand restore (environments-v3 C16) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-03 | ⚠ 1 коммит(ов) в areas после сверки: b5149bc3 feat(shared): environments-v3 contracts |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 259 коммит(ов) в areas после сверки: aa6b503c chore: pin environments-v3 releases (Kanban 0.1.6, Core UI 1.4.15, Desktop 1.0.18, agent 0.21.0) … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-30 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 211 коммит(ов) в areas после сверки: aa6b503c chore: pin environments-v3 releases (Kanban 0.1.6, Core UI 1.4.15, Desktop 1.0.18, agent 0.21.0) … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ⚠ 14 коммит(ов) в areas после сверки: 87edbfa7 feat(server): persistent environment links (environments-v3 C14) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1015. Последние:

- [2026-10-03-pc-radvilovich-tailae39a6-ts-net-environments-v3-shared-contracts.md](log/2026-10-03-pc-radvilovich-tailae39a6-ts-net-environments-v3-shared-contracts.md) — environments-v3-shared-contracts
- [2026-10-03-delivery-c15-placement-aware-compose.md](log/2026-10-03-delivery-c15-placement-aware-compose.md) — placement-aware-compose
- [2026-10-03-alexeys-macbook-air-2-stand-module-profiles.md](log/2026-10-03-alexeys-macbook-air-2-stand-module-profiles.md) — stand-module-profiles
- [2026-10-03-alexeys-macbook-air-2-stand-link-ports.md](log/2026-10-03-alexeys-macbook-air-2-stand-link-ports.md) — stand-link-ports
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-5.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-5.md) — pin-kanban-0.1.5
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-4.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-4.md) — pin-kanban-0.1.4
- [2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-3-core-ui-1-4-14-desktop-1-0-17.md](log/2026-10-03-alexeys-macbook-air-2-pin-kanban-0-1-3-core-ui-1-4-14-desktop-1-0-17.md) — pin-kanban-0.1.3-core-ui-1.4.14-desktop-1.0.17
- [2026-10-03-alexeys-macbook-air-2-pin-core-ui-1-4-13-desktop-1-0-16.md](log/2026-10-03-alexeys-macbook-air-2-pin-core-ui-1-4-13-desktop-1-0-16.md) — pin-core-ui-1.4.13-desktop-1.0.16
- [2026-10-03-alexeys-macbook-air-2-owner-pack-integrity-format.md](log/2026-10-03-alexeys-macbook-air-2-owner-pack-integrity-format.md) — owner-pack-integrity-format
- [2026-10-03-alexeys-macbook-air-2-environments-v3-pins.md](log/2026-10-03-alexeys-macbook-air-2-environments-v3-pins.md) — environments-v3-pins

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

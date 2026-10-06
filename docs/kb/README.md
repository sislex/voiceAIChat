<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 22 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 35 коммит(ов) в areas после сверки: 7f397ace Merge origin/main into dc/kb-service-v1-u03 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-06 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ⚠ 20 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 17 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ⚠ 8 коммит(ов) в areas после сверки: 0692d1dd refactor(kb): isolate the knowledge engine in @voicechat/knowledge (kb-service-v1 U03) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-06 | ⚠ 1 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 76 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 43 коммит(ов) в areas после сверки: 304afe00 fix(machines): expand the dev stand repository shorthand into a clone URL … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 279 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 424 коммит(ов) в areas после сверки: 7f397ace Merge origin/main into dc/kb-service-v1-u03 … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 54 коммит(ов) в areas после сверки: 7f397ace Merge origin/main into dc/kb-service-v1-u03 … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 10 коммит(ов) в areas после сверки: 7f397ace Merge origin/main into dc/kb-service-v1-u03 … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 64 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 23 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 30 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 5 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 96 коммит(ов) в areas после сверки: 7f397ace Merge origin/main into dc/kb-service-v1-u03 … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-05, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 5 коммит(ов) в areas после сверки: 8f186384 feat(dev-stand): stand gateway, Core dev mode and dev build rejection (dev-lane-v1 C02) … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 98 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 40 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ⚠ 73 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 437 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 2 коммит(ов) в areas после сверки: 02cbb132 docs(kb): module ownership map (kb-service-v1 U02, partial) … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ⚠ 9 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-06 | ⚠ 2 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [modules.md](modules.md) | Module ownership map | 2026-10-05 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ⚠ 19 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-06 | ⚠ 2 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-05 | ⚠ 13 коммит(ов) в areas после сверки: 304afe00 fix(machines): expand the dev stand repository shorthand into a clone URL … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-06 | ⚠ 1 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 284 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-06 | ⚠ 10 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 236 коммит(ов) в areas после сверки: ef73e475 chore: pin Kanban 0.2.10, Core UI 1.5.6 and Desktop 1.0.25 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ⚠ 27 коммит(ов) в areas после сверки: e7b14a42 feat(shared): release disk preflight contract (release-disk-preflight-v1 B01) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1093. Последние:

- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-task-gate-module-scope.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-task-gate-module-scope.md) — task-gate-module-scope
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-disk-preflight-b01.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-release-disk-preflight-b01.md) — release-disk-preflight-b01
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-25.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-25.md) — pin-shared-0-1-25
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-4-0.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-make-1-4-0.md) — pin-make-1-4-0
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-9.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-9.md) — pin-kanban-0-2-9
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-10-core-ui-1-5-6.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-10-core-ui-1-5-6.md) — pin-kanban-0-2-10-core-ui-1-5-6
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-5-desktop-1-0-24.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-5-desktop-1-0-24.md) — pin-core-ui-1-5-5-desktop-1-0-24
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-23-0.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-pin-agent-0-23-0.md) — pin-agent-0-23-0
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-dev-process-clone-url.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-dev-process-clone-url.md) — dev-process-clone-url
- [2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-core-github-token.md](log/2026-10-06-alexeys-macbook-air-tailae39a6-ts-net-core-github-token.md) — core-github-token

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

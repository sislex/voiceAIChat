<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 19 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 31 коммит(ов) в areas после сверки: 4f44c3a2 feat(server): compress JSON API responses (make-chat-service-data-v1 C02) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-05 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ⚠ 8 коммит(ов) в areas после сверки: 1f70cd50 chore: pin Core UI 1.5.3 and Desktop 1.0.22 (paged history, virtualized timeline) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 14 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ⚠ 7 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-05 | ⚠ 1 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 60 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 38 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 271 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 419 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 50 коммит(ов) в areas после сверки: 4f44c3a2 feat(server): compress JSON API responses (make-chat-service-data-v1 C02) … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 6 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 57 коммит(ов) в areas после сверки: c143f684 Merge origin/main into dc/reliability-v2-b01 … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 16 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 27 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1802 коммит(ов) в areas после сверки: 1f70cd50 chore: pin Core UI 1.5.3 and Desktop 1.0.22 (paged history, virtualized timeline) … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 92 коммит(ов) в areas после сверки: c143f684 Merge origin/main into dc/reliability-v2-b01 … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 4 коммит(ов) в areas после сверки: 97660b3c feat(gates): gate:quick and test:files with GATE-FAILED-TESTS (delivery-fast-gate-v1 C03) … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 84 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 40 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ⚠ 66 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 429 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-29 | ⚠ 4 коммит(ов) в areas после сверки: 97660b3c feat(gates): gate:quick and test:files with GATE-FAILED-TESTS (delivery-fast-gate-v1 C03) … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ⚠ 6 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-05 | ⚠ 4 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ⚠ 16 коммит(ов) в areas после сверки: 7d4696a0 feat(shared): paged history in the conversations:get IPC contract … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-05 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-05 | ⚠ 4 коммит(ов) в areas после сверки: c143f684 Merge origin/main into dc/reliability-v2-b01 … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-05 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 274 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-04 | ⚠ 18 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 226 коммит(ов) в areas после сверки: 7f33b6ef chore: pin Kanban 0.2.7 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ⚠ 20 коммит(ов) в areas после сверки: c1677631 feat(chat): paged conversation history (reliability-v2 B01) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1068. Последние:

- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-u04-results.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-u04-results.md) — u04-results
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-stand-lan-proxy.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-stand-lan-proxy.md) — stand-lan-proxy
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-21.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-21.md) — pin-shared-0-1-21
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-20.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-20.md) — pin-shared-0-1-20
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-19.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-19.md) — pin-shared-0-1-19
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-18.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-18.md) — pin-shared-0-1-18
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-7.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-7.md) — pin-kanban-0-2-7
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-6.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-6.md) — pin-kanban-0-2-6
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-3.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-3.md) — pin-core-ui-1-5-3
- [2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-2.md](log/2026-10-05-alexeys-macbook-air-tailae39a6-ts-net-pin-core-ui-1-5-2.md) — pin-core-ui-1-5-2

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

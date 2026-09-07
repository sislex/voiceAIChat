<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-01 | ⚠ 61 коммит(ов) в areas после сверки: a6ff6f34 Merge main into CHAT-411 (task 483738c1-ff14-45e8-bae3-482cdca1db0c) … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 274 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-07 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-07 | ⚠ 11 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-07 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-06 | ⚠ 22 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 126 коммит(ов) в areas после сверки: 377bf745 Merge origin/main (CHAT-411: циклы доработки) в refactor/db-repositories … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 81 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 254 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 168 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-04 | ⚠ 43 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 50 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-04 | ⚠ 47 коммит(ов) в areas после сверки: 377bf745 Merge origin/main (CHAT-411: циклы доработки) в refactor/db-repositories … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1231 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-06 | ⚠ 15 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-05 | ⚠ 48 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-06 | ⚠ 23 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-05 | ⚠ 45 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 269 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 13 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-06 | ⚠ 10 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-07 | ⚠ 12 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 205 коммит(ов) в areas после сверки: 33a7972d Merge pull request #108 from sislex/perf/board-two-phase … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-07 | ⚠ 7 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-07 | ⚠ 10 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-07 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-03 | ⚠ 40 коммит(ов) в areas после сверки: a6ff6f34 Merge main into CHAT-411 (task 483738c1-ff14-45e8-bae3-482cdca1db0c) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 173 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 5 коммит(ов) в areas после сверки: d4710360 refactor(db): круг 3 — асинхронные порты репозиториев … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-04 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 125 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-07 | ⚠ 16 коммит(ов) в areas после сверки: 9ff8fe71 refactor(make): граница Make ↔ ядро — порты MakeCore/MakeService, HMAC scope-токены, гейт границы … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-07, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/make](../../apps/make/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/sessions-app](../../packages/sessions-app/AGENTS.md)
- [packages/sessions-core](../../packages/sessions-core/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 642. Последние:

- [2026-09-07-alexeys-macbook-air-2-task-rework-cycles.md](log/2026-09-07-alexeys-macbook-air-2-task-rework-cycles.md) — task-rework-cycles
- [2026-09-07-alexeys-macbook-air-2-task-card-request-storm.md](log/2026-09-07-alexeys-macbook-air-2-task-card-request-storm.md) — task-card-request-storm
- [2026-09-07-alexeys-macbook-air-2-scroll-paged-chat-list.md](log/2026-09-07-alexeys-macbook-air-2-scroll-paged-chat-list.md) — scroll-paged-chat-list
- [2026-09-07-alexeys-macbook-air-2-make-standalone-round2.md](log/2026-09-07-alexeys-macbook-air-2-make-standalone-round2.md) — make-standalone-round2
- [2026-09-07-alexeys-macbook-air-2-make-standalone-round1.md](log/2026-09-07-alexeys-macbook-air-2-make-standalone-round1.md) — make-standalone-round1
- [2026-09-07-alexeys-macbook-air-2-db-repositories.md](log/2026-09-07-alexeys-macbook-air-2-db-repositories.md) — db-repositories
- [2026-09-06-pc-radvilovich-make-stack-settings.md](log/2026-09-06-pc-radvilovich-make-stack-settings.md) — make-stack-settings
- [2026-09-06-alexeys-macbook-air-2-rework-cycles.md](log/2026-09-06-alexeys-macbook-air-2-rework-cycles.md) — rework-cycles
- [2026-09-06-alexeys-macbook-air-2-releases-tab-no-board.md](log/2026-09-06-alexeys-macbook-air-2-releases-tab-no-board.md) — releases-tab-no-board
- [2026-09-06-alexeys-macbook-air-2-new-task-card-rework-tests.md](log/2026-09-06-alexeys-macbook-air-2-new-task-card-rework-tests.md) — new-task-card-rework-tests

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

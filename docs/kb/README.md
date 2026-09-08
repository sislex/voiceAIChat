<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-01 | ⚠ 64 коммит(ов) в areas после сверки: 10665c2b Merge main into CHAT-421 (task 127849dd-93d5-4145-9f73-7005da497446) … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 284 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 6 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-07 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-07 | ⚠ 2 коммит(ов) в areas после сверки: d3802b2c feat(db): перенос SQLite → Postgres проверен на копии прод-БД; NUL-байты в текстах вырезаются … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-07 | ⚠ 2 коммит(ов) в areas после сверки: 0aa1868d fix(compose): пароль Postgres не обязателен при выключенном профиле … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-06 | ⚠ 35 коммит(ов) в areas после сверки: 0aa1868d fix(compose): пароль Postgres не обязателен при выключенном профиле … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 132 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 93 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 266 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 175 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-04 | ⚠ 50 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 60 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-04 | ⚠ 55 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1248 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-06 | ⚠ 22 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-05 | ⚠ 60 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-06 | ⚠ 30 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-05 | ⚠ 57 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 276 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 14 коммит(ов) в areas после сверки: a40ef0e5 feat(make): пакет apps/make и режим отдельного процесса — внутренний API ядра, пересылка авторизации … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-07 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-07 | ⚠ 23 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 208 коммит(ов) в areas после сверки: 10665c2b Merge main into CHAT-421 (task 127849dd-93d5-4145-9f73-7005da497446) … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-08 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-07 | ⚠ 16 коммит(ов) в areas после сверки: 69e52066 feat(db): Postgres как движок базы — адаптер pg, транслятор диалекта, схема из schema.ts, перенос данных … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-07 | ⚠ 11 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-03 | ⚠ 41 коммит(ов) в areas после сверки: a40ef0e5 feat(make): пакет apps/make и режим отдельного процесса — внутренний API ядра, пересылка авторизации … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 181 коммит(ов) в areas после сверки: 0aa1868d fix(compose): пароль Postgres не обязателен при выключенном профиле … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 5 коммит(ов) в areas после сверки: d4710360 refactor(db): круг 3 — асинхронные порты репозиториев … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-04 | ⚠ 4 коммит(ов) в areas после сверки: 0aa1868d fix(compose): пароль Postgres не обязателен при выключенном профиле … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 133 коммит(ов) в areas после сверки: 0aa1868d fix(compose): пароль Postgres не обязателен при выключенном профиле … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-07 | ⚠ 3 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
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

Всего записей: 651. Последние:

- [2026-09-08-alexeys-macbook-air-2-new-task-card-complete.md](log/2026-09-08-alexeys-macbook-air-2-new-task-card-complete.md) — new-task-card-complete
- [2026-09-07-macbook-air-user-make-permission-mode.md](log/2026-09-07-macbook-air-user-make-permission-mode.md) — make-permission-mode
- [2026-09-07-macbook-air-user-hidden-chat-settings.md](log/2026-09-07-macbook-air-user-hidden-chat-settings.md) — hidden-chat-settings
- [2026-09-07-macbook-air-user-chat-message-switch-isolation.md](log/2026-09-07-macbook-air-user-chat-message-switch-isolation.md) — chat-message-switch-isolation
- [2026-09-07-alexeys-macbook-air-2-task-rework-cycles.md](log/2026-09-07-alexeys-macbook-air-2-task-rework-cycles.md) — task-rework-cycles
- [2026-09-07-alexeys-macbook-air-2-task-card-request-storm.md](log/2026-09-07-alexeys-macbook-air-2-task-card-request-storm.md) — task-card-request-storm
- [2026-09-07-alexeys-macbook-air-2-scroll-paged-chat-list.md](log/2026-09-07-alexeys-macbook-air-2-scroll-paged-chat-list.md) — scroll-paged-chat-list
- [2026-09-07-alexeys-macbook-air-2-make-standalone-round3.md](log/2026-09-07-alexeys-macbook-air-2-make-standalone-round3.md) — make-standalone-round3
- [2026-09-07-alexeys-macbook-air-2-make-standalone-round2.md](log/2026-09-07-alexeys-macbook-air-2-make-standalone-round2.md) — make-standalone-round2
- [2026-09-07-alexeys-macbook-air-2-make-standalone-round1.md](log/2026-09-07-alexeys-macbook-air-2-make-standalone-round1.md) — make-standalone-round1

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

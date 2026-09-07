<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-01 | ⚠ 64 коммит(ов) в areas после сверки: 10665c2b Merge main into CHAT-421 (task 127849dd-93d5-4145-9f73-7005da497446) … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 290 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 12 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-08 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-08 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-07 | ⚠ 1 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-06 | ⚠ 40 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 136 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 99 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 272 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 181 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-04 | ⚠ 56 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 66 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-04 | ⚠ 55 коммит(ов) в areas после сверки: c1ace3e4 Merge remote-tracking branch 'origin/main' into feat/db-postgres … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1255 коммит(ов) в areas после сверки: 023a890a docs(plans): прогон этапа 3 на копии прод-БД четырьмя процессами … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-06 | ⚠ 28 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-05 | ⚠ 66 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-06 | ⚠ 36 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-05 | ⚠ 63 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 282 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 14 коммит(ов) в areas после сверки: a40ef0e5 feat(make): пакет apps/make и режим отдельного процесса — внутренний API ядра, пересылка авторизации … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-07 | ⚠ 2 коммит(ов) в areas после сверки: 1a932d19 refactor(machines): модуль машин и порт MachinesService … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-07 | ⚠ 27 коммит(ов) в areas после сверки: b3091e19 feat(machines): машины отдельным процессом — VC_MACHINES_MODE=remote, HttpMachines, шина событий и прокси /agent … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 208 коммит(ов) в areas после сверки: 10665c2b Merge main into CHAT-421 (task 127849dd-93d5-4145-9f73-7005da497446) … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-07 | ⚠ 20 коммит(ов) в areas после сверки: a5e98af1 feat(kanban): канбан отдельным процессом — VC_KANBAN_MODE=remote, HttpKanbanCore, прокси и внутренний API … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-07 | ⚠ 21 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-07 | ⚠ 1 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-03 | ⚠ 42 коммит(ов) в areas после сверки: a5e98af1 feat(kanban): канбан отдельным процессом — VC_KANBAN_MODE=remote, HttpKanbanCore, прокси и внутренний API … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 186 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 5 коммит(ов) в areas после сверки: d4710360 refactor(db): круг 3 — асинхронные порты репозиториев … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-04 | ⚠ 6 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 138 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-07 | ⚠ 9 коммит(ов) в areas после сверки: 7d786444 feat(admin): админка отдельным процессом — VC_ADMIN_MODE=remote; внутренний API машин общий для ядра и процесса машин … |
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

Всего записей: 657. Последние:

- [2026-09-08-alexeys-macbook-air-2-pg-quarantine.md](log/2026-09-08-alexeys-macbook-air-2-pg-quarantine.md) — pg-quarantine
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

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-01 | ⚠ 71 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 296 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 17 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-08 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-08 | ⚠ 1 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-08 | ⚠ 1 коммит(ов) в areas после сверки: a4c83d04 fix(ws): потолок исходящей очереди соединения — клиент, не вычитывающий кадры, отключается |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-06 | ⚠ 59 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 138 коммит(ов) в areas после сверки: 7ce37a59 Merge remote-tracking branch 'origin/main' into feat/distributed-polish … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 113 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 284 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 183 коммит(ов) в areas после сверки: a4c83d04 fix(ws): потолок исходящей очереди соединения — клиент, не вычитывающий кадры, отключается … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-04 | ⚠ 62 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 75 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-04 | ⚠ 62 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1270 коммит(ов) в areas после сверки: a45e2dde docs(kb): update after merge afb55149-4d95-417c-a4f2-85adcf6b6ae3 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-06 | ⚠ 36 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-08 | ✓ |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-06 | ⚠ 42 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-05 | ⚠ 75 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 287 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 14 коммит(ов) в areas после сверки: a40ef0e5 feat(make): пакет apps/make и режим отдельного процесса — внутренний API ядра, пересылка авторизации … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-07 | ⚠ 6 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-08 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 214 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-08 | ⚠ 1 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-07 | ⚠ 27 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-08 | ⚠ 11 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-03 | ⚠ 45 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 189 коммит(ов) в areas после сверки: a4c83d04 fix(ws): потолок исходящей очереди соединения — клиент, не вычитывающий кадры, отключается … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 5 коммит(ов) в areas после сверки: d4710360 refactor(db): круг 3 — асинхронные порты репозиториев … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-08 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 141 коммит(ов) в areas после сверки: a4c83d04 fix(ws): потолок исходящей очереди соединения — клиент, не вычитывающий кадры, отключается … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-08 | ⚠ 4 коммит(ов) в areas после сверки: a7e8e5b4 CHAT-431 restrict release machines and remember selection … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-08, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 666. Последние:

- [2026-09-08-macbook-air-user-ui-settings-routes.md](log/2026-09-08-macbook-air-user-ui-settings-routes.md) — ui-settings-routes
- [2026-09-08-macbook-air-user-task-card-ai-chat.md](log/2026-09-08-macbook-air-user-task-card-ai-chat.md) — task-card-ai-chat
- [2026-09-08-macbook-air-user-instant-conversation-settings-loader.md](log/2026-09-08-macbook-air-user-instant-conversation-settings-loader.md) — instant-conversation-settings-loader
- [2026-09-08-macbook-air-user-assistant-settings-routes.md](log/2026-09-08-macbook-air-user-assistant-settings-routes.md) — assistant-settings-routes
- [2026-09-08-alexeys-macbook-air-2-release-machine-catalog.md](log/2026-09-08-alexeys-macbook-air-2-release-machine-catalog.md) — release-machine-catalog
- [2026-09-08-alexeys-macbook-air-2-prod-postgres.md](log/2026-09-08-alexeys-macbook-air-2-prod-postgres.md) — prod-postgres
- [2026-09-08-alexeys-macbook-air-2-pg-quarantine.md](log/2026-09-08-alexeys-macbook-air-2-pg-quarantine.md) — pg-quarantine
- [2026-09-08-alexeys-macbook-air-2-oom-exec-stream.md](log/2026-09-08-alexeys-macbook-air-2-oom-exec-stream.md) — oom-exec-stream
- [2026-09-08-alexeys-macbook-air-2-new-task-card-complete.md](log/2026-09-08-alexeys-macbook-air-2-new-task-card-complete.md) — new-task-card-complete
- [2026-09-08-alexeys-macbook-air-2-distributed-polish.md](log/2026-09-08-alexeys-macbook-air-2-distributed-polish.md) — distributed-polish

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

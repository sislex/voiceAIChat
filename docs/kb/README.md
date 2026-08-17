<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-16 | ⚠ 10 коммит(ов) в areas после сверки: fc03446 CHAT-261 push CLI auth status over WebSocket … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-17 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 4 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-17 | ⚠ 8 коммит(ов) в areas после сверки: 0722654 Merge task 74271cfa-2e33-4e40-a749-b4fa566e450b … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ код изменён 2026-08-17, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-17 | ⚠ 10 коммит(ов) в areas после сверки: 4bfa650 Merge task 921a6b8e-8634-40af-a3b5-616af0e2986c … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: 0722654 Merge task 74271cfa-2e33-4e40-a749-b4fa566e450b … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 19 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 58 коммит(ов) в areas после сверки: fc03446 CHAT-261 push CLI auth status over WebSocket … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 18 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-16 | ⚠ 20 коммит(ов) в areas после сверки: c9bb6df feat(ui): add kanban assignee filters … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 406 коммит(ов) в areas после сверки: 4bfa650 Merge task 921a6b8e-8634-40af-a3b5-616af0e2986c … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-16 | ⚠ 21 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ код изменён 2026-08-17, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 1 коммит(ов) в areas после сверки: 5318356 CHAT-253: стадия kb_update merge-рана наследует движок development-рана |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-17 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-17 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-17 | ⚠ 1 коммит(ов) в areas после сверки: c9bb6df feat(ui): add kanban assignee filters |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-17 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-17 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-15 | ⚠ 24 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ 14 коммит(ов) в areas после сверки: eb4cc6e Merge task fc3e4541-e7fd-4460-a8f7-3f8f17da8ebd … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-17 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-17 | ⚠ 3 коммит(ов) в areas после сверки: 4bfa650 Merge task 921a6b8e-8634-40af-a3b5-616af0e2986c … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-17, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 250. Последние:

- [2026-08-17-mac-task-timeline.md](log/2026-08-17-mac-task-timeline.md) — task-timeline
- [2026-08-17-mac-task-tabs-workflow-preview.md](log/2026-08-17-mac-task-tabs-workflow-preview.md) — task-tabs-workflow-preview
- [2026-08-17-mac-model-work-disclosure-git-transport.md](log/2026-08-17-mac-model-work-disclosure-git-transport.md) — model-work-disclosure-git-transport
- [2026-08-17-mac-merge-retry-machine.md](log/2026-08-17-mac-merge-retry-machine.md) — merge-retry-machine
- [2026-08-17-mac-kanban-stage-arrows.md](log/2026-08-17-mac-kanban-stage-arrows.md) — kanban-stage-arrows
- [2026-08-17-mac-kanban-column-scroll.md](log/2026-08-17-mac-kanban-column-scroll.md) — kanban-column-scroll
- [2026-08-17-mac-feature-preview-access-copy.md](log/2026-08-17-mac-feature-preview-access-copy.md) — feature-preview-access-copy
- [2026-08-17-mac-domain-stores-kb-gaps.md](log/2026-08-17-mac-domain-stores-kb-gaps.md) — domain-stores-kb-gaps
- [2026-08-17-mac-chat-task-assignee.md](log/2026-08-17-mac-chat-task-assignee.md) — chat-task-assignee
- [2026-08-17-mac-chat-app-boundary.md](log/2026-08-17-mac-chat-app-boundary.md) — chat-app-boundary

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

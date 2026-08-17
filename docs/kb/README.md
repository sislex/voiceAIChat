<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-16 | ⚠ 7 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 12 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 4 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-17 | ⚠ 3 коммит(ов) в areas после сверки: 98d833e fix(preview): open local services and secure SSH fallback … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ код изменён 2026-08-16, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-17 | ⚠ 9 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 12 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 57 коммит(ов) в areas после сверки: 6e34b72 feat(preparation): движок и модель подготовки из настроек этапа … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 9 коммит(ов) в areas после сверки: 98d833e fix(preview): open local services and secure SSH fallback … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-16 | ⚠ 11 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 383 коммит(ов) в areas после сверки: 322b63f docs(kb): update after merge 08a53eda-7ac3-4ebc-8243-f21c5ef1ec5e … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-16 | ⚠ 12 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ код изменён 2026-08-17, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 1 коммит(ов) в areas после сверки: 5318356 CHAT-253: стадия kb_update merge-рана наследует движок development-рана |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 13 коммит(ов) в areas после сверки: 056f5c7 fix(chat): publish queued messages in turn order … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-16 | ⚠ 8 коммит(ов) в areas после сверки: 98d833e fix(preview): open local services and secure SSH fallback … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 51 коммит(ов) в areas после сверки: 98d833e fix(preview): open local services and secure SSH fallback … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-15 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-17 | ⚠ 4 коммит(ов) в areas после сверки: 4cd802b Merge task c28521b8-b836-4ccf-b158-78a7d50b35a4 … |
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

Всего записей: 240. Последние:

- [2026-08-17-mac-task-tabs-workflow-preview.md](log/2026-08-17-mac-task-tabs-workflow-preview.md) — task-tabs-workflow-preview
- [2026-08-17-mac-model-work-disclosure-git-transport.md](log/2026-08-17-mac-model-work-disclosure-git-transport.md) — model-work-disclosure-git-transport
- [2026-08-17-mac-merge-retry-machine.md](log/2026-08-17-mac-merge-retry-machine.md) — merge-retry-machine
- [2026-08-17-mac-kanban-stage-arrows.md](log/2026-08-17-mac-kanban-stage-arrows.md) — kanban-stage-arrows
- [2026-08-17-mac-kanban-column-scroll.md](log/2026-08-17-mac-kanban-column-scroll.md) — kanban-column-scroll
- [2026-08-17-mac-feature-preview-access-copy.md](log/2026-08-17-mac-feature-preview-access-copy.md) — feature-preview-access-copy
- [2026-08-17-mac-domain-stores-kb-gaps.md](log/2026-08-17-mac-domain-stores-kb-gaps.md) — domain-stores-kb-gaps
- [2026-08-17-mac-chat-task-assignee.md](log/2026-08-17-mac-chat-task-assignee.md) — chat-task-assignee
- [2026-08-17-mac-chat-app-boundary.md](log/2026-08-17-mac-chat-app-boundary.md) — chat-app-boundary
- [2026-08-17-mac-cancelled-task-chat-visibility.md](log/2026-08-17-mac-cancelled-task-chat-visibility.md) — cancelled-task-chat-visibility

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

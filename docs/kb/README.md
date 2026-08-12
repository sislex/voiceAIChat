<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 72 коммит(ов) в areas после сверки: 26f5477 fix: дождаться завершения production deploy … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 35 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-12 | ⚠ 1 коммит(ов) в areas после сверки: 31c5e8b feat: execute merge runs with realtime feed |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-12 | ⚠ 6 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: f2b5d60 fix(ci): name task branches and workspaces by issue key … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 31 коммит(ов) в areas после сверки: 31c5e8b feat: execute merge runs with realtime feed … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 36 коммит(ов) в areas после сверки: 31c5e8b feat: execute merge runs with realtime feed … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-10 | ⚠ 12 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-12 | ⚠ 7 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 225 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-12 | ⚠ 2 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 9 коммит(ов) в areas после сверки: abc8bc6 chatai-178: работа CI-рана … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 4 коммит(ов) в areas после сверки: f105bc7 feat: share project machines with members … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 4 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-11 | ⚠ 11 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 25 коммит(ов) в areas после сверки: 26f5477 fix: дождаться завершения production deploy … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 40 коммит(ов) в areas после сверки: 1593fd1 fix: run merge on workspace machine … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 17 коммит(ов) в areas после сверки: 26f5477 fix: дождаться завершения production deploy … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 10 коммит(ов) в areas после сверки: 9daab6d fix(docker): make whisper build portable on arm64 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-10 | ⚠ 20 коммит(ов) в areas после сверки: 26f5477 fix: дождаться завершения production deploy … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-12, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-07 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 168. Последние:

- [2026-08-12-alexeys-macbook-air-2-merge-runner.md](log/2026-08-12-alexeys-macbook-air-2-merge-runner.md) — merge-runner
- [2026-08-12-2470-com-release-version-production.md](log/2026-08-12-2470-com-release-version-production.md) — release-version-production
- [2026-08-12-2470-com-release-run-management.md](log/2026-08-12-2470-com-release-run-management.md) — release-run-management
- [2026-08-12-2470-com-chat-machine-access.md](log/2026-08-12-2470-com-chat-machine-access.md) — chat-machine-access
- [2026-08-12-2470-com-chat-176-task-tabs.md](log/2026-08-12-2470-com-chat-176-task-tabs.md) — chat-176-task-tabs
- [2026-08-11-alexeys-macbook-air-2-shared-project-machines.md](log/2026-08-11-alexeys-macbook-air-2-shared-project-machines.md) — shared-project-machines
- [2026-08-11-alexeys-macbook-air-2-kanban-column-menu.md](log/2026-08-11-alexeys-macbook-air-2-kanban-column-menu.md) — kanban-column-menu
- [2026-08-11-2470-com-production-release-branch-deploy.md](log/2026-08-11-2470-com-production-release-branch-deploy.md) — production-release-branch-deploy
- [2026-08-10-mac-versioned-release-deploy.md](log/2026-08-10-mac-versioned-release-deploy.md) — versioned-release-deploy
- [2026-08-10-mac-task-launch-fields.md](log/2026-08-10-mac-task-launch-fields.md) — task-launch-fields

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

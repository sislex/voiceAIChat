<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 66 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 30 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-08 | ⚠ 15 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-10 | ⚠ 5 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: f2b5d60 fix(ci): name task branches and workspaces by issue key … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 29 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 35 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-10 | ⚠ 7 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 206 коммит(ов) в areas после сверки: c199867 fix: run release checks in bounded stages … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-11 | ⚠ 7 коммит(ов) в areas после сверки: c199867 fix: run release checks in bounded stages … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 8 коммит(ов) в areas после сверки: bcb8716 fix: исключить индекс из свежести базы знаний … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 4 коммит(ов) в areas после сверки: f105bc7 feat: share project machines with members … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-11 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-11 | ⚠ 3 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 19 коммит(ов) в areas после сверки: d3821f2 fix: make release gates and deploy restart-safe … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 29 коммит(ов) в areas после сверки: c199867 fix: run release checks in bounded stages … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 11 коммит(ов) в areas после сверки: bbe7cc7 fix: distinguish release upgrades from rollbacks … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 10 коммит(ов) в areas после сверки: 9daab6d fix(docker): make whisper build portable on arm64 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-10 | ⚠ 11 коммит(ов) в areas после сверки: bbe7cc7 fix: distinguish release upgrades from rollbacks … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-10, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 163. Последние:

- [2026-08-11-alexeys-macbook-air-2-shared-project-machines.md](log/2026-08-11-alexeys-macbook-air-2-shared-project-machines.md) — shared-project-machines
- [2026-08-11-alexeys-macbook-air-2-kanban-column-menu.md](log/2026-08-11-alexeys-macbook-air-2-kanban-column-menu.md) — kanban-column-menu
- [2026-08-11-2470-com-production-release-branch-deploy.md](log/2026-08-11-2470-com-production-release-branch-deploy.md) — production-release-branch-deploy
- [2026-08-10-mac-versioned-release-deploy.md](log/2026-08-10-mac-versioned-release-deploy.md) — versioned-release-deploy
- [2026-08-10-mac-task-launch-fields.md](log/2026-08-10-mac-task-launch-fields.md) — task-launch-fields
- [2026-08-10-mac-manual-qa.md](log/2026-08-10-mac-manual-qa.md) — manual-qa
- [2026-08-10-mac-feature-preview.md](log/2026-08-10-mac-feature-preview.md) — feature-preview
- [2026-08-10-mac-feature-preview-docker-preflight.md](log/2026-08-10-mac-feature-preview-docker-preflight.md) — feature-preview-docker-preflight
- [2026-08-10-2470-com-stable-feature-preview-qa-preparation.md](log/2026-08-10-2470-com-stable-feature-preview-qa-preparation.md) — stable-feature-preview-qa-preparation
- [2026-08-10-2470-com-merge-run-tabs.md](log/2026-08-10-2470-com-merge-run-tabs.md) — merge-run-tabs

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

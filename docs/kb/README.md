<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 88 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-13 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-13 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-13 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: f2b5d60 fix(ci): name task branches and workspaces by issue key … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-13 | ⚠ 6 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 40 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-13 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-13 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 281 коммит(ов) в areas после сверки: 0809d50 Merge task 1b54ce57-4d00-4bca-8daf-a71982d9d58d … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-13 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-13 | ⚠ 2 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 10 коммит(ов) в areas после сверки: a69c7a4 fix(merge): разрешить конфликты CHAT-184 с main … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 17 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-13 | ⚠ 18 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 17 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 79 коммит(ов) в areas после сверки: 0809d50 Merge task 1b54ce57-4d00-4bca-8daf-a71982d9d58d … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 36 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-13 | ⚠ 3 коммит(ов) в areas после сверки: 5fa3d61 fix(CHAT-194): validate production release version … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-13 | ⚠ 18 коммит(ов) в areas после сверки: c6a4a95 feat(CHAT-198): redesign task workflow card … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-13, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

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

Всего записей: 184. Последние:

- [2026-08-13-mac-task-launch-dialog.md](log/2026-08-13-mac-task-launch-dialog.md) — task-launch-dialog
- [2026-08-13-mac-sidebar-toggle-kanban.md](log/2026-08-13-mac-sidebar-toggle-kanban.md) — sidebar-toggle-kanban
- [2026-08-13-mac-release-version-footer.md](log/2026-08-13-mac-release-version-footer.md) — release-version-footer
- [2026-08-13-mac-personalization.md](log/2026-08-13-mac-personalization.md) — personalization
- [2026-08-13-mac-development-merge-workflow.md](log/2026-08-13-mac-development-merge-workflow.md) — development-merge-workflow
- [2026-08-13-mac-chat-189-run-steps-popover.md](log/2026-08-13-mac-chat-189-run-steps-popover.md) — chat-189-run-steps-popover
- [2026-08-13-alexeys-macbook-air-2-task-card-manual-qa.md](log/2026-08-13-alexeys-macbook-air-2-task-card-manual-qa.md) — task-card-manual-qa
- [2026-08-13-alexeys-macbook-air-2-roles-rbac.md](log/2026-08-13-alexeys-macbook-air-2-roles-rbac.md) — roles-rbac
- [2026-08-13-alexeys-macbook-air-2-chat-190-release-version.md](log/2026-08-13-alexeys-macbook-air-2-chat-190-release-version.md) — chat-190-release-version
- [2026-08-13-2470-com-task-machine-access.md](log/2026-08-13-2470-com-task-machine-access.md) — task-machine-access

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

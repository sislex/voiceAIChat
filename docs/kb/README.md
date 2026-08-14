<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 100 коммит(ов) в areas после сверки: 70fb9bf Merge task f2659ed3-a453-443d-b68c-1dd6242c2da5 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-13 | ⚠ код изменён 2026-08-14, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ 2 коммит(ов) в areas после сверки: 7f63dcc feat(preview): open remote environments via agent tunnel … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-14 | ⚠ 3 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-14 | ⚠ 3 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-13 | ⚠ код изменён 2026-08-14, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 46 коммит(ов) в areas после сверки: 7f63dcc feat(preview): open remote environments via agent tunnel … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-14 | ⚠ 8 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-14 | ⚠ 18 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 324 коммит(ов) в areas после сверки: f7a4ecf fix(release): install regression dependencies in worktree … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-13 | ⚠ 3 коммит(ов) в areas после сверки: 9b5cd4c feat: complete manual QA workflow … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 13 коммит(ов) в areas после сверки: 056f5c7 fix(chat): publish queued messages in turn order … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 33 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-14 | ⚠ 3 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 29 коммит(ов) в areas после сверки: 6944dfd Merge task 3c74a077-42ef-42b7-835a-6b3bdd7564ac … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-14 | ⚠ 18 коммит(ов) в areas после сверки: f7a4ecf fix(release): install regression dependencies in worktree … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 51 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-14 | ⚠ 5 коммит(ов) в areas после сверки: e4e0437 Merge release/0.1.42 into main … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-14 | ⚠ 15 коммит(ов) в areas после сверки: af66dd7 Merge task CHAT-194 … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-14, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 207. Последние:

- [2026-08-14-alexeys-macbook-air-2-test-gate-hang-diagnostics.md](log/2026-08-14-alexeys-macbook-air-2-test-gate-hang-diagnostics.md) — test-gate-hang-diagnostics
- [2026-08-14-alexeys-macbook-air-2-task-modal-heading.md](log/2026-08-14-alexeys-macbook-air-2-task-modal-heading.md) — task-modal-heading
- [2026-08-14-alexeys-macbook-air-2-task-launch-task-modal.md](log/2026-08-14-alexeys-macbook-air-2-task-launch-task-modal.md) — task-launch-task-modal
- [2026-08-14-alexeys-macbook-air-2-run-feed-inline.md](log/2026-08-14-alexeys-macbook-air-2-run-feed-inline.md) — run-feed-inline
- [2026-08-14-alexeys-macbook-air-2-releases-page-loading-machine.md](log/2026-08-14-alexeys-macbook-air-2-releases-page-loading-machine.md) — releases-page-loading-machine
- [2026-08-14-alexeys-macbook-air-2-release-regression-dependencies.md](log/2026-08-14-alexeys-macbook-air-2-release-regression-dependencies.md) — release-regression-dependencies
- [2026-08-14-alexeys-macbook-air-2-release-metadata-detached-deploy.md](log/2026-08-14-alexeys-macbook-air-2-release-metadata-detached-deploy.md) — release-metadata-detached-deploy
- [2026-08-14-alexeys-macbook-air-2-queued-message-order.md](log/2026-08-14-alexeys-macbook-air-2-queued-message-order.md) — queued-message-order
- [2026-08-14-alexeys-macbook-air-2-multiple-project-owners.md](log/2026-08-14-alexeys-macbook-air-2-multiple-project-owners.md) — multiple-project-owners
- [2026-08-14-alexeys-macbook-air-2-manual-qa-preparation-workspace.md](log/2026-08-14-alexeys-macbook-air-2-manual-qa-preparation-workspace.md) — manual-qa-preparation-workspace

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

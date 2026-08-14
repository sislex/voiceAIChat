<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 105 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 3 коммит(ов) в areas после сверки: 0769dc3 CHAT-228: Component QA поддерживает JSON-массив стадий в test_command … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-13 | ⚠ код изменён 2026-08-14, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ 7 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-14 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-14 | ⚠ 12 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-13 | ⚠ код изменён 2026-08-14, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 51 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-14 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-14 | ⚠ 5 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 338 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-14 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ 10 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-13 | ⚠ 3 коммит(ов) в areas после сверки: 9b5cd4c feat: complete manual QA workflow … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 13 коммит(ов) в areas после сверки: 056f5c7 fix(chat): publish queued messages in turn order … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 42 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-14 | ⚠ 5 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 37 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-14 | ⚠ 27 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 59 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-14 | ⚠ 6 коммит(ов) в areas после сверки: 0769dc3 CHAT-228: Component QA поддерживает JSON-массив стадий в test_command … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-14 | ⚠ 3 коммит(ов) в areas после сверки: f1a3888 Merge origin/main into CHAT-226: reconcile QA stage runs with component QA automation … |
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

Всего записей: 213. Последние:

- [2026-08-14-mac-ui-board-fixtures-canonical-columns.md](log/2026-08-14-mac-ui-board-fixtures-canonical-columns.md) — ui-board-fixtures-canonical-columns
- [2026-08-14-mac-qa-stage-runs.md](log/2026-08-14-mac-qa-stage-runs.md) — qa-stage-runs
- [2026-08-14-mac-component-qa-test-stages.md](log/2026-08-14-mac-component-qa-test-stages.md) — component-qa-test-stages
- [2026-08-14-mac-component-qa-automation.md](log/2026-08-14-mac-component-qa-automation.md) — component-qa-automation
- [2026-08-14-mac-autostart-development-run.md](log/2026-08-14-mac-autostart-development-run.md) — autostart-development-run
- [2026-08-14-alexeys-macbook-air-2-test-gate-hang-diagnostics.md](log/2026-08-14-alexeys-macbook-air-2-test-gate-hang-diagnostics.md) — test-gate-hang-diagnostics
- [2026-08-14-alexeys-macbook-air-2-task-modal-heading.md](log/2026-08-14-alexeys-macbook-air-2-task-modal-heading.md) — task-modal-heading
- [2026-08-14-alexeys-macbook-air-2-task-launch-task-modal.md](log/2026-08-14-alexeys-macbook-air-2-task-launch-task-modal.md) — task-launch-task-modal
- [2026-08-14-alexeys-macbook-air-2-run-feed-inline.md](log/2026-08-14-alexeys-macbook-air-2-run-feed-inline.md) — run-feed-inline
- [2026-08-14-alexeys-macbook-air-2-releases-page-loading-machine.md](log/2026-08-14-alexeys-macbook-air-2-releases-page-loading-machine.md) — releases-page-loading-machine

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

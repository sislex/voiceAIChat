<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 55 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 22 коммит(ов) в areas после сверки: ab6b78d feat: extend preview environments and manual QA workflow … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-08 | ⚠ 3 коммит(ов) в areas после сверки: 1d2008b CHAT-165: добавить версионные release-ветки и центр деплоя … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-10 | ⚠ 1 коммит(ов) в areas после сверки: ab6b78d feat: extend preview environments and manual QA workflow |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 18 коммит(ов) в areas после сверки: ab6b78d feat: extend preview environments and manual QA workflow … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 25 коммит(ов) в areas после сверки: 1d2008b CHAT-165: добавить версионные release-ветки и центр деплоя … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-10 | ⚠ 1 коммит(ов) в areas после сверки: ab6b78d feat: extend preview environments and manual QA workflow |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 175 коммит(ов) в areas после сверки: ab6b78d feat: extend preview environments and manual QA workflow … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: 647043a chatai-165: работа CI-рана … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 3 коммит(ов) в areas после сверки: d9b71af fix: preserve task launch proposal fields … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-10 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 15 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 10 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-10 | ⚠ 2 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: 3899375 feat: add task feature preview environments … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-09 | ⚠ 7 коммит(ов) в areas после сверки: 55b196e fix: keep kanban assistant chat selection embedded … |
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

Всего записей: 157. Последние:

- [2026-08-10-mac-versioned-release-deploy.md](log/2026-08-10-mac-versioned-release-deploy.md) — versioned-release-deploy
- [2026-08-10-mac-task-launch-fields.md](log/2026-08-10-mac-task-launch-fields.md) — task-launch-fields
- [2026-08-10-mac-manual-qa.md](log/2026-08-10-mac-manual-qa.md) — manual-qa
- [2026-08-10-mac-feature-preview.md](log/2026-08-10-mac-feature-preview.md) — feature-preview
- [2026-08-10-mac-feature-preview-docker-preflight.md](log/2026-08-10-mac-feature-preview-docker-preflight.md) — feature-preview-docker-preflight
- [2026-08-10-2470-com-kanban-assistant-conversation-selector.md](log/2026-08-10-2470-com-kanban-assistant-conversation-selector.md) — kanban-assistant-conversation-selector
- [2026-08-09-mac-test-fix-cycle.md](log/2026-08-09-mac-test-fix-cycle.md) — test-fix-cycle
- [2026-08-09-mac-grouped-fail-fast-pipeline.md](log/2026-08-09-mac-grouped-fail-fast-pipeline.md) — grouped-fail-fast-pipeline
- [2026-08-09-alexeys-macbook-air-2-web-reader-fullscreen.md](log/2026-08-09-alexeys-macbook-air-2-web-reader-fullscreen.md) — web-reader-fullscreen
- [2026-08-09-2470-com-workflow-stage-llm.md](log/2026-08-09-2470-com-workflow-stage-llm.md) — workflow-stage-llm

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 33 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 3 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-07 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-07 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-03 | ⚠ 29 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 13 коммит(ов) в areas после сверки: f60fcc9 feat: add personal LLM model access controls … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 99 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-06 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-06 | ⚠ 1 коммит(ов) в areas после сверки: aecf8a0 feat: add hierarchical LLM settings |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-05 | ⚠ 2 коммит(ов) в areas после сверки: 68b9d2f CHAT-108: пустой ход модели не закрывает ран успехом … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-07 | ⚠ 1 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-05 | ⚠ 11 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-06 | ⚠ 4 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-07 | ⚠ 1 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 19 коммит(ов) в areas после сверки: 722cf5c fix(ci): avoid duplicate vitest silent flag … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-07 | ⚠ 1 коммит(ов) в areas после сверки: 406a596 feat: добавить веб-превью рядом с чатом |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-07, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 107. Последние:

- [2026-08-07-alexeys-macbook-air-2-chat-preview-split.md](log/2026-08-07-alexeys-macbook-air-2-chat-preview-split.md) — chat-preview-split
- [2026-08-07-2470-com-llm-settings-inheritance.md](log/2026-08-07-2470-com-llm-settings-inheritance.md) — llm-settings-inheritance
- [2026-08-07-2470-com-admin-model-prices.md](log/2026-08-07-2470-com-admin-model-prices.md) — admin-model-prices
- [2026-08-06-2470-com-users-dashboard.md](log/2026-08-06-2470-com-users-dashboard.md) — users-dashboard
- [2026-08-06-2470-com-ui-llm-access.md](log/2026-08-06-2470-com-ui-llm-access.md) — ui-llm-access
- [2026-08-06-2470-com-task-launch-message-meta.md](log/2026-08-06-2470-com-task-launch-message-meta.md) — task-launch-message-meta
- [2026-08-06-2470-com-sidebar-rename.md](log/2026-08-06-2470-com-sidebar-rename.md) — sidebar-rename
- [2026-08-06-2470-com-sidebar-chat-label.md](log/2026-08-06-2470-com-sidebar-chat-label.md) — sidebar-chat-label
- [2026-08-06-2470-com-rename-llm-history.md](log/2026-08-06-2470-com-rename-llm-history.md) — rename-llm-history
- [2026-08-06-2470-com-project-settings-tabs-llm.md](log/2026-08-06-2470-com-project-settings-tabs-llm.md) — project-settings-tabs-llm

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

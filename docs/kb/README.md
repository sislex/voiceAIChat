<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 3 коммит(ов) в areas после сверки: f472ccc Add public MCP base for runner … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 5 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-01 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: f472ccc Add public MCP base for runner |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: f472ccc Add public MCP base for runner |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-01 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: f472ccc Add public MCP base for runner |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-01 | ⚠ 10 коммит(ов) в areas после сверки: 1f5374b chatai-61: работа CI-рана … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 9c3ab50 feat(llm-runner): каркас исполнителя LLM — apps/llm-runner и POST /v1/run … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-01 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-31 | ⚠ 12 коммит(ов) в areas после сверки: f472ccc Add public MCP base for runner … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-01 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-01 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-01 | ⚠ 3 коммит(ов) в areas после сверки: 6171b3c Fix turns MCP public base test kb stub … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-01 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-01 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-01 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ✓ |

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

Всего записей: 54. Последние:

- [2026-08-01-2470-com-список-чатов-обновляется-по-событиям.md](log/2026-08-01-2470-com-список-чатов-обновляется-по-событиям.md) — Список чатов обновляется по событиям, а не только по действиям
- [2026-08-01-2470-com-пересборка-прода-chat-52.md](log/2026-08-01-2470-com-пересборка-прода-chat-52.md) — пересборка-прода-chat-52
- [2026-08-01-2470-com-пересборка-прода-chat-44.md](log/2026-08-01-2470-com-пересборка-прода-chat-44.md) — пересборка-прода-chat-44
- [2026-08-01-2470-com-vc-mcp-public-base.md](log/2026-08-01-2470-com-vc-mcp-public-base.md) — vc-mcp-public-base
- [2026-08-01-2470-com-task-chat-widget-scoped-to-chat.md](log/2026-08-01-2470-com-task-chat-widget-scoped-to-chat.md) — Виджет задачи виден только в своём чате
- [2026-08-01-2470-com-runner-fs-api-proxy.md](log/2026-08-01-2470-com-runner-fs-api-proxy.md) — Файловые API исполнителя для проводника CC/Codex и статуса логина
- [2026-08-01-2470-com-remote-runner-attachments-cwd.md](log/2026-08-01-2470-com-remote-runner-attachments-cwd.md) — Вложения и cwd теперь разрешаются на стороне исполнителя
- [2026-08-01-2470-com-remote-llm-client-na-servere.md](log/2026-08-01-2470-com-remote-llm-client-na-servere.md) — RemoteLlmClient на сервере
- [2026-08-01-2470-com-otchyot-po-zadache-rashod-modeli.md](log/2026-08-01-2470-com-otchyot-po-zadache-rashod-modeli.md) — Отчёт по завершённой задаче — расход модели, запросы и шаги CI
- [2026-08-01-2470-com-opisanie-zadachi-markdown.md](log/2026-08-01-2470-com-opisanie-zadachi-markdown.md) — Описание задачи — маркдаун в просмотре, правка по кнопке

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

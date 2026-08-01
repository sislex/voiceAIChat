<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-27 | ⚠ 29 коммит(ов) в areas после сверки: 06bb73e CI: база знаний в работе модели рана (контекст, mcp__kb__*, статистика) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 5 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-27 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-01 | ⚠ 5 коммит(ов) в areas после сверки: 5639098 Виджет задачи виден только в своём чате … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-01 | ⚠ 5 коммит(ов) в areas после сверки: 5639098 Виджет задачи виден только в своём чате … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-01 | ⚠ 3 коммит(ов) в areas после сверки: d93eb7c chatai-48: kb-MCP отдаёт тело транспорту — гейт не падает отложенным исключением … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-01 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: c37b32a CI: шаг «Актуализировать базу знаний» после работы модели |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: f7f3e97 Merge feature/46-ci-раннер-тесты-гоняет-только-воркфлоу-ц … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-31 | ⚠ 11 коммит(ов) в areas после сверки: 925d7f0 chatai-46: работа CI-рана … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-01 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-01 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-07-27 | ⚠ 54 коммит(ов) в areas после сверки: 5639098 Виджет задачи виден только в своём чате … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-07-27 | ⚠ 30 коммит(ов) в areas после сверки: 5639098 Виджет задачи виден только в своём чате … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-07-31 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-01 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 42. Последние:

- [2026-08-01-2470-com-пересборка-прода-chat-44.md](log/2026-08-01-2470-com-пересборка-прода-chat-44.md) — пересборка-прода-chat-44
- [2026-08-01-2470-com-task-chat-widget-scoped-to-chat.md](log/2026-08-01-2470-com-task-chat-widget-scoped-to-chat.md) — Виджет задачи виден только в своём чате
- [2026-08-01-2470-com-opisanie-zadachi-markdown.md](log/2026-08-01-2470-com-opisanie-zadachi-markdown.md) — Описание задачи — маркдаун в просмотре, правка по кнопке
- [2026-08-01-2470-com-kb-v-rane-modeli.md](log/2026-08-01-2470-com-kb-v-rane-modeli.md) — База знаний в работе модели CI-рана
- [2026-08-01-2470-com-kb-scopes.md](log/2026-08-01-2470-com-kb-scopes.md) — kb-scopes
- [2026-08-01-2470-com-kb-auto-update.md](log/2026-08-01-2470-com-kb-auto-update.md) — kb-auto-update
- [2026-08-01-2470-com-ci-gate-workflow-only.md](log/2026-08-01-2470-com-ci-gate-workflow-only.md) — ci-gate-workflow-only
- [2026-07-31-2470-com-task-chat-highlight.md](log/2026-07-31-2470-com-task-chat-highlight.md) — task-chat-highlight
- [2026-07-31-2470-com-storybook-foundations.md](log/2026-07-31-2470-com-storybook-foundations.md) — storybook-foundations
- [2026-07-31-2470-com-storybook-chat-ci.md](log/2026-07-31-2470-com-storybook-chat-ci.md) — storybook-chat-ci

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

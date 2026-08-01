<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-27 | ⚠ 26 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 5 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-27 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-30 | ⚠ 6 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-07-31 | ⚠ 3 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-07-31 | ⚠ 2 коммит(ов) в areas после сверки: afe60a1 feat(kanban): завершённые задачи уходят с доски по порогу проекта … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-01 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: 4ca77de docs(kb): коммит в прод-каталоге пушится сразу — иначе прод не fast-forward … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-29 | ⚠ 9 коммит(ов) в areas после сверки: c27fe65 feat(kb): панель «Использование БЗ» + телеметрия обращений модели … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-31 | ⚠ 10 коммит(ов) в areas после сверки: 0b57fea fix(agent): Windows-машина выполняет команды через bash.exe, а не cmd.exe … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-01 | ⚠ 5 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-31 | ⚠ 3 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-07-27 | ⚠ 42 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-07-27 | ⚠ 22 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-07-31 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-07-31 | ⚠ 3 коммит(ов) в areas после сверки: 41d11e8 feat(chats): чаты завершённых задач уходят из списка бесед … |
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

Всего записей: 36. Последние:

- [2026-08-01-2470-com-kb-scopes.md](log/2026-08-01-2470-com-kb-scopes.md) — kb-scopes
- [2026-07-31-2470-com-task-chat-highlight.md](log/2026-07-31-2470-com-task-chat-highlight.md) — task-chat-highlight
- [2026-07-31-2470-com-storybook-foundations.md](log/2026-07-31-2470-com-storybook-foundations.md) — storybook-foundations
- [2026-07-31-2470-com-storybook-chat-ci.md](log/2026-07-31-2470-com-storybook-chat-ci.md) — storybook-chat-ci
- [2026-07-31-2470-com-prod-rebuild-followup-task.md](log/2026-07-31-2470-com-prod-rebuild-followup-task.md) — prod-rebuild-followup-task
- [2026-07-31-2470-com-kb-usage-panel.md](log/2026-07-31-2470-com-kb-usage-panel.md) — kb-usage-panel
- [2026-07-31-2470-com-kanban-pointer-dnd.md](log/2026-07-31-2470-com-kanban-pointer-dnd.md) — kanban-pointer-dnd
- [2026-07-31-2470-com-kanban-column-scroll.md](log/2026-07-31-2470-com-kanban-column-scroll.md) — kanban-column-scroll
- [2026-07-31-2470-com-command-palette.md](log/2026-07-31-2470-com-command-palette.md) — command-palette
- [2026-07-31-2470-com-awaiting-merge-column.md](log/2026-07-31-2470-com-awaiting-merge-column.md) — awaiting-merge-column

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

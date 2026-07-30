<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-27 | ⚠ 14 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: 1ea7495 feat(ui): add reusable AI prompt builder … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-27 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-27 | ⚠ 14 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-30 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-07-29 | ⚠ код изменён 2026-07-30, сверка 2026-07-29 (по датам: правки того же дня не видны — поставь checked) |
| [features/feature-workflow.md](features/feature-workflow.md) | Feature Run — выполнение задач агентом в изолированных Git-workspace | 2026-07-28 | ⚠ 19 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-07-27 | ⚠ код изменён 2026-07-30, сверка 2026-07-27 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-27 | ⚠ 1 коммит(ов) в areas после сверки: 95f654f docs(kb): document complete project architecture |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-29 | ⚠ 4 коммит(ов) в areas после сверки: 0e6e5f4 fix(turns): сохранять завершённый ответ при остановке сервера … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: 1007ea1 feat(ci): бэкенд CI-раннера — контракт, схема, раннер, модель в цикле, MCP-инструмент … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-07-29 | ⚠ 21 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-29 | ⚠ 10 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-07-27 | ⚠ 23 коммит(ов) в areas после сверки: 006a43e fix(ci): не передавать remote workspace как cwd контейнера … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-07-27 | ⚠ 10 коммит(ов) в areas после сверки: d38f05a feat(ci): запрашивать подтверждение для сброса dirty workspace … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-07-27 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-07-29 | ⚠ 13 коммит(ов) в areas после сверки: 3a5b554 feat(kanban): сделать связанный чат заметным на карточке … |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 22. Последние:

- [2026-07-30-alexeys-macbook-air-2-prod-502-container-created.md](log/2026-07-30-alexeys-macbook-air-2-prod-502-container-created.md) — prod-502-container-created
- [2026-07-29-2470-com-ai-prompt-builder.md](log/2026-07-29-2470-com-ai-prompt-builder.md) — ai-prompt-builder
- [2026-07-27-repo-2-project-knowledge-base.md](log/2026-07-27-repo-2-project-knowledge-base.md) — project-knowledge-base
- [2026-07-27-2470-com-windows-install-command-cmd.md](log/2026-07-27-2470-com-windows-install-command-cmd.md) — windows-install-command-cmd
- [2026-07-27-2470-com-projects-kanban.md](log/2026-07-27-2470-com-projects-kanban.md) — projects-kanban
- [2026-07-27-2470-com-project-chat-link.md](log/2026-07-27-2470-com-project-chat-link.md) — project-chat-link
- [2026-07-27-2470-com-disable-voice-input.md](log/2026-07-27-2470-com-disable-voice-input.md) — disable-voice-input
- [2026-07-27-2470-com-comprehensive-project-knowledge.md](log/2026-07-27-2470-com-comprehensive-project-knowledge.md) — comprehensive-project-knowledge
- [2026-07-27-2470-com-codex-usage-explorer-address.md](log/2026-07-27-2470-com-codex-usage-explorer-address.md) — codex-usage-explorer-address
- [2026-07-27-2470-com-codex-plan-read-only.md](log/2026-07-27-2470-com-codex-plan-read-only.md) — codex-plan-read-only

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

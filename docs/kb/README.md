<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-26 | ⚠ 9 коммит(ов) в areas после сверки: c9f17a9 feat: show live token usage while responding … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-26 | ⚠ 1 коммит(ов) в areas после сверки: 49ded98 feat: add project knowledge base |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-27 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-26 | ⚠ 2 коммит(ов) в areas после сверки: 49ded98 feat: add project knowledge base … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-07-27 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-26 | ⚠ 2 коммит(ов) в areas после сверки: d867705 docs(kb): тема projects.md для режима Проекты + канбан; журнал; регенерация индекса … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: c9f17a9 feat: show live token usage while responding … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: c50ada0 chore(agent): bump AGENT_VERSION 0.9.0 → 0.9.1 (console pipe-fallback fix) … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-07-27 | ⚠ 3 коммит(ов) в areas после сверки: c9f17a9 feat: show live token usage while responding … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-27 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 17. Последние:

- [2026-07-27-repo-2-project-knowledge-base.md](log/2026-07-27-repo-2-project-knowledge-base.md) — project-knowledge-base
- [2026-07-27-2470-com-windows-install-command-cmd.md](log/2026-07-27-2470-com-windows-install-command-cmd.md) — windows-install-command-cmd
- [2026-07-27-2470-com-projects-kanban.md](log/2026-07-27-2470-com-projects-kanban.md) — projects-kanban
- [2026-07-27-2470-com-project-chat-link.md](log/2026-07-27-2470-com-project-chat-link.md) — project-chat-link
- [2026-07-27-2470-com-codex-plan-read-only.md](log/2026-07-27-2470-com-codex-plan-read-only.md) — codex-plan-read-only
- [2026-07-27-2470-com-chat-lifecycle-status.md](log/2026-07-27-2470-com-chat-lifecycle-status.md) — chat-lifecycle-status
- [2026-07-26-localhost-popup-file-terminal-context.md](log/2026-07-26-localhost-popup-file-terminal-context.md) — popup-file-terminal-context
- [2026-07-26-alexeys-macbook-air-2-база-знаний-для-агентов.md](log/2026-07-26-alexeys-macbook-air-2-база-знаний-для-агентов.md) — база знаний для агентов
- [2026-07-26-alexeys-macbook-air-2-image-in-message.md](log/2026-07-26-alexeys-macbook-air-2-image-in-message.md) — image-in-message
- [2026-07-26-alexeys-macbook-air-2-composer-autogrow.md](log/2026-07-26-alexeys-macbook-air-2-composer-autogrow.md) — composer-autogrow

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

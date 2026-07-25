<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-26 | ⚠ 1 коммит(ов) в areas после сверки: 4b248e3 feat(chat): независимый выбор машины для каждого чата |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-26 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-25 | ⚠ 2 коммит(ов) в areas после сверки: 1ad6184 fix(chat): перенести выбор машины в шапку беседы … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-26 | ✓ |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-26 | ⚠ 1 коммит(ов) в areas после сверки: aa35067 docs(kb): сверка свежести по sha коммита + факты про execTarget и cliProfiles |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-26 | ⚠ 1 коммит(ов) в areas после сверки: 4b248e3 feat(chat): независимый выбор машины для каждого чата |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-25 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-25 | ✓ |
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

Всего записей: 3. Последние:

- [2026-07-26-alexeys-macbook-air-2-база-знаний-для-агентов.md](log/2026-07-26-alexeys-macbook-air-2-база-знаний-для-агентов.md) — база знаний для агентов
- [2026-07-26-alexeys-macbook-air-2-composer-autogrow.md](log/2026-07-26-alexeys-macbook-air-2-composer-autogrow.md) — composer-autogrow
- [2026-07-25-2470-com-chat-exec-target.md](log/2026-07-25-2470-com-chat-exec-target.md) — chat-exec-target

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

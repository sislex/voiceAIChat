<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 28 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-04 | ⚠ 14 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-05 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-06 | ⚠ 1 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-03 | ⚠ 26 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 12 коммит(ов) в areas после сверки: fc34191 feat(machine): вкладки PTY-сеансов и таймаут простоя … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 76 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-06 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-06 | ⚠ 2 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-05 | ⚠ 2 коммит(ов) в areas после сверки: 68b9d2f CHAT-108: пустой ход модели не закрывает ран успехом … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-06 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-05 | ⚠ 6 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-05 | ⚠ 12 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-06 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 14 коммит(ов) в areas после сверки: 68b9d2f CHAT-108: пустой ход модели не закрывает ран успехом … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-06 | ⚠ 1 коммит(ов) в areas после сверки: a7bd878 feat(chat): show task proposal from message meta |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-06, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-05 | ✓ |

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

Всего записей: 96. Последние:

- [2026-08-06-2470-com-task-launch-message-meta.md](log/2026-08-06-2470-com-task-launch-message-meta.md) — task-launch-message-meta
- [2026-08-06-2470-com-sidebar-chat-label.md](log/2026-08-06-2470-com-sidebar-chat-label.md) — sidebar-chat-label
- [2026-08-06-2470-com-live-run-timers-kb.md](log/2026-08-06-2470-com-live-run-timers-kb.md) — live-run-timers-kb
- [2026-08-06-2470-com-ci-run-empty-work-guard.md](log/2026-08-06-2470-com-ci-run-empty-work-guard.md) — Пустой ход модели больше не закрывает ран успехом
- [2026-08-06-2470-com-ci-model-self-verification.md](log/2026-08-06-2470-com-ci-model-self-verification.md) — ci-model-self-verification
- [2026-08-06-2470-com-108-live-run-timers.md](log/2026-08-06-2470-com-108-live-run-timers.md) — 108-live-run-timers
- [2026-08-05-2470-com-удаление-машины-из-ui.md](log/2026-08-05-2470-com-удаление-машины-из-ui.md) — удаление-машины-из-ui
- [2026-08-05-2470-com-user-account-usage.md](log/2026-08-05-2470-com-user-account-usage.md) — user-account-usage
- [2026-08-05-2470-com-ui-usage-report.md](log/2026-08-05-2470-com-ui-usage-report.md) — ui-usage-report
- [2026-08-05-2470-com-machines-file-explorer.md](log/2026-08-05-2470-com-machines-file-explorer.md) — machines-file-explorer

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

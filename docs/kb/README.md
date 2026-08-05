<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 24 коммит(ов) в areas после сверки: 5cad358 feat: expose personal usage and account context … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-04 | ⚠ 10 коммит(ов) в areas после сверки: 05a6c5d feat(ui): удаление машины из раздела «Машины» и редактор политики строки … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-05 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-05 | ⚠ 2 коммит(ов) в areas после сверки: 05a6c5d feat(ui): удаление машины из раздела «Машины» и редактор политики строки … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-03 | ⚠ 22 коммит(ов) в areas после сверки: 5cad358 feat: expose personal usage and account context … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 10 коммит(ов) в areas после сверки: 5cad358 feat: expose personal usage and account context … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 55 коммит(ов) в areas после сверки: 05a6c5d feat(ui): удаление машины из раздела «Машины» и редактор политики строки … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-03 | ⚠ 2 коммит(ов) в areas после сверки: e3a1439 fix(ci): validate KB update repository root … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-03 | ⚠ 17 коммит(ов) в areas после сверки: 5cad358 feat: expose personal usage and account context … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-05 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-05 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-05 | ⚠ 3 коммит(ов) в areas после сверки: 05a6c5d feat(ui): удаление машины из раздела «Машины» и редактор политики строки … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-05 | ⚠ 3 коммит(ов) в areas после сверки: 05a6c5d feat(ui): удаление машины из раздела «Машины» и редактор политики строки … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-04 | ⚠ 5 коммит(ов) в areas после сверки: 5cad358 feat: expose personal usage and account context … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 13 коммит(ов) в areas после сверки: 8c4b7a8 chatai-94: compact CI test workflow … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-05 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-05, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 86. Последние:

- [2026-08-05-2470-com-удаление-машины-из-ui.md](log/2026-08-05-2470-com-удаление-машины-из-ui.md) — удаление-машины-из-ui
- [2026-08-05-2470-com-user-account-usage.md](log/2026-08-05-2470-com-user-account-usage.md) — user-account-usage
- [2026-08-05-2470-com-ui-usage-report.md](log/2026-08-05-2470-com-ui-usage-report.md) — ui-usage-report
- [2026-08-05-2470-com-ci-workflow-98.md](log/2026-08-05-2470-com-ci-workflow-98.md) — ci-workflow-98
- [2026-08-05-2470-com-ci-test-workflow.md](log/2026-08-05-2470-com-ci-test-workflow.md) — ci-test-workflow
- [2026-08-05-2470-com-ci-runner-workflow.md](log/2026-08-05-2470-com-ci-runner-workflow.md) — ci-runner-workflow
- [2026-08-05-2470-com-chat-files-contract.md](log/2026-08-05-2470-com-chat-files-contract.md) — chat-files-contract
- [2026-08-04-2470-com-user-usage-codex-pricing.md](log/2026-08-04-2470-com-user-usage-codex-pricing.md) — user-usage-codex-pricing
- [2026-08-04-2470-com-task-launch-structured-signal.md](log/2026-08-04-2470-com-task-launch-structured-signal.md) — task-launch-structured-signal
- [2026-08-04-2470-com-image-history-prompt.md](log/2026-08-04-2470-com-image-history-prompt.md) — image-history-prompt

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

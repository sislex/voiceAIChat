<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 23 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-04 | ⚠ 9 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-02 | ⚠ 2 коммит(ов) в areas после сверки: 6975e38 feat: показать версию и дату прод-релиза … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-05 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-03 | ⚠ 21 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 9 коммит(ов) в areas после сверки: 103017e feat(chat): persist attachment metadata and render images … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 49 коммит(ов) в areas после сверки: 97c339b CHAT-97: исправить CI-воркфлоу ChatAI … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-03 | ⚠ 2 коммит(ов) в areas после сверки: e3a1439 fix(ci): validate KB update repository root … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-03 | ⚠ 16 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-02 | ⚠ 4 коммит(ов) в areas после сверки: 4db7c74 Show reconnecting state for machine utilities … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-04 | ⚠ 6 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-05 | ⚠ 1 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-05 | ⚠ 1 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-04 | ⚠ 4 коммит(ов) в areas после сверки: 4934f4a fix(shared): align IPC attachment contracts … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 13 коммит(ов) в areas после сверки: 8c4b7a8 chatai-94: compact CI test workflow … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-04 | ⚠ 5 коммит(ов) в areas после сверки: cb4d4a0 feat(ci): наследование LLM и контекст БЗ … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-04, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |

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

Всего записей: 82. Последние:

- [2026-08-05-2470-com-ci-test-workflow.md](log/2026-08-05-2470-com-ci-test-workflow.md) — ci-test-workflow
- [2026-08-05-2470-com-ci-runner-workflow.md](log/2026-08-05-2470-com-ci-runner-workflow.md) — ci-runner-workflow
- [2026-08-05-2470-com-chat-files-contract.md](log/2026-08-05-2470-com-chat-files-contract.md) — chat-files-contract
- [2026-08-04-2470-com-user-usage-codex-pricing.md](log/2026-08-04-2470-com-user-usage-codex-pricing.md) — user-usage-codex-pricing
- [2026-08-04-2470-com-task-launch-structured-signal.md](log/2026-08-04-2470-com-task-launch-structured-signal.md) — task-launch-structured-signal
- [2026-08-04-2470-com-image-history-prompt.md](log/2026-08-04-2470-com-image-history-prompt.md) — image-history-prompt
- [2026-08-04-2470-com-ci-model-repo-workdir.md](log/2026-08-04-2470-com-ci-model-repo-workdir.md) — ci-model-repo-workdir
- [2026-08-04-2470-com-ci-merge-conflict-resolution.md](log/2026-08-04-2470-com-ci-merge-conflict-resolution.md) — ci-merge-conflict-resolution
- [2026-08-04-2470-com-ci-kb-root-validation.md](log/2026-08-04-2470-com-ci-kb-root-validation.md) — ci-kb-root-validation
- [2026-08-04-2470-com-ci-affected-check-full-fallback.md](log/2026-08-04-2470-com-ci-affected-check-full-fallback.md) — ci-affected-check-full-fallback

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

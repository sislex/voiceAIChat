<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 39 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 8 коммит(ов) в areas после сверки: 8f12df0 CHAT-134: параллельный запуск и распределение тасков по машинам … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-07 | ⚠ 3 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-07 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 16 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 118 коммит(ов) в areas после сверки: c63d43d chatai-134: работа CI-рана … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-06 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-06 | ⚠ 3 коммит(ов) в areas после сверки: 440c8c3 feat: add session-bound production deploy tool … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-05 | ⚠ 3 коммит(ов) в areas после сверки: abeab22 feat(admin): add protected production deploy API … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-07 | ⚠ 4 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-05 | ⚠ 18 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-06 | ⚠ 13 коммит(ов) в areas после сверки: b5a7961 fix(ci): dequeue queued run when moving task to todo … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-07 | ⚠ 8 коммит(ов) в areas после сверки: 8f12df0 CHAT-134: параллельный запуск и распределение тасков по машинам … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 3 коммит(ов) в areas после сверки: 8d6061d fix(prod): keep deploy socket reachable after restart … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: 8f12df0 CHAT-134: параллельный запуск и распределение тасков по машинам … |
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

Всего записей: 118. Последние:

- [2026-08-07-mac-parallel-run-machine-routing.md](log/2026-08-07-mac-parallel-run-machine-routing.md) — parallel-run-machine-routing
- [2026-08-07-mac-kb-gaps-parallel-run-machine-routing.md](log/2026-08-07-mac-kb-gaps-parallel-run-machine-routing.md) — kb-gaps-parallel-run-machine-routing
- [2026-08-07-alexeys-macbook-air-2-task-execution-machine.md](log/2026-08-07-alexeys-macbook-air-2-task-execution-machine.md) — task-execution-machine
- [2026-08-07-alexeys-macbook-air-2-multi-task-launch.md](log/2026-08-07-alexeys-macbook-air-2-multi-task-launch.md) — Несколько предложений задач и fast-stage Vitest
- [2026-08-07-alexeys-macbook-air-2-done-order.md](log/2026-08-07-alexeys-macbook-air-2-done-order.md) — done-order
- [2026-08-07-alexeys-macbook-air-2-ci-runner-production-routing.md](log/2026-08-07-alexeys-macbook-air-2-ci-runner-production-routing.md) — ci-runner-production-routing
- [2026-08-07-alexeys-macbook-air-2-ci-runner-move-dequeue.md](log/2026-08-07-alexeys-macbook-air-2-ci-runner-move-dequeue.md) — ci-runner-move-dequeue
- [2026-08-07-alexeys-macbook-air-2-ci-runner-dequeue.md](log/2026-08-07-alexeys-macbook-air-2-ci-runner-dequeue.md) — ci-runner-dequeue
- [2026-08-07-alexeys-macbook-air-2-chat-preview-split.md](log/2026-08-07-alexeys-macbook-air-2-chat-preview-split.md) — chat-preview-split
- [2026-08-07-alexeys-macbook-air-2-chat-preview-split-kb-gaps.md](log/2026-08-07-alexeys-macbook-air-2-chat-preview-split-kb-gaps.md) — chat-preview-split-kb-gaps

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

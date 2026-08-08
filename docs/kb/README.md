<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 45 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 1 коммит(ов) в areas после сверки: e39fa65 feat(ci): проверять только затронутые пакеты |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 13 коммит(ов) в areas после сверки: 17679ee fix: выпуск preview-cookie из Bearer для восстановленных сессий … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-08 | ⚠ 8 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 20 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 134 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: aa6ac12 fix(ci): увеличить таймаут актуализации базы знаний … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-07 | ⚠ 5 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 1 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-08 | ⚠ 1 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 3 коммит(ов) в areas после сверки: 8d6061d fix(prod): keep deploy socket reachable after restart … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-08 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-08, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 129. Последние:

- [2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md](log/2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md) — web-preview-element-context
- [2026-08-08-alexeys-macbook-air-2-preview-proxy.md](log/2026-08-08-alexeys-macbook-air-2-preview-proxy.md) — preview-proxy
- [2026-08-08-alexeys-macbook-air-2-preview-inspector.md](log/2026-08-08-alexeys-macbook-air-2-preview-inspector.md) — preview-inspector
- [2026-08-08-alexeys-macbook-air-2-preview-cookie-ensure.md](log/2026-08-08-alexeys-macbook-air-2-preview-cookie-ensure.md) — preview-cookie-ensure
- [2026-08-08-alexeys-macbook-air-2-preview-cookie-auth.md](log/2026-08-08-alexeys-macbook-air-2-preview-cookie-auth.md) — preview-cookie-auth
- [2026-08-08-alexeys-macbook-air-2-preview-browser-actions.md](log/2026-08-08-alexeys-macbook-air-2-preview-browser-actions.md) — preview-browser-actions
- [2026-08-08-alexeys-macbook-air-2-chat-133-kb-update-timeout-20m.md](log/2026-08-08-alexeys-macbook-air-2-chat-133-kb-update-timeout-20m.md) — chat-133-kb-update-timeout-20m
- [2026-08-07-mac-parallel-run-machine-routing.md](log/2026-08-07-mac-parallel-run-machine-routing.md) — parallel-run-machine-routing
- [2026-08-07-mac-kb-gaps-parallel-run-machine-routing.md](log/2026-08-07-mac-kb-gaps-parallel-run-machine-routing.md) — kb-gaps-parallel-run-machine-routing
- [2026-08-07-alexeys-macbook-air-2-закрыты-пробелы-kb-project-machines-mcp.md](log/2026-08-07-alexeys-macbook-air-2-закрыты-пробелы-kb-project-machines-mcp.md) — закрыты-пробелы-kb-project-machines-mcp

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 49 коммит(ов) в areas после сверки: a499867 chatai-150: показывать коммит и задачу в версии … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 15 коммит(ов) в areas после сверки: 71e983e feat(ui): вынести веб-рекордер на отдельную страницу … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-08 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-08 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 10 коммит(ов) в areas после сверки: a499867 chatai-150: показывать коммит и задачу в версии … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 21 коммит(ов) в areas после сверки: a499867 chatai-150: показывать коммит и задачу в версии … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 153 коммит(ов) в areas после сверки: 59f9312 feat(ci): drain runs before prod rebuild … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 3 коммит(ов) в areas после сверки: 2517d1c chatai-147: работа CI-рана … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 2 коммит(ов) в areas после сверки: a1858af feat: add universal widget tool gateway … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-08 | ⚠ 3 коммит(ов) в areas после сверки: 508f449 feat(ui): rename web recorder to web reader … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 7 коммит(ов) в areas после сверки: 71e983e feat(ui): вынести веб-рекордер на отдельную страницу … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 7 коммит(ов) в areas после сверки: 59f9312 feat(ci): drain runs before prod rebuild … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-08 | ⚠ 7 коммит(ов) в areas после сверки: 71e983e feat(ui): вынести веб-рекордер на отдельную страницу … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 5 коммит(ов) в areas после сверки: a499867 chatai-150: показывать коммит и задачу в версии … |
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

Всего записей: 142. Последние:

- [2026-08-08-alexeys-macbook-air-2-widget-tool-gateway.md](log/2026-08-08-alexeys-macbook-air-2-widget-tool-gateway.md) — widget-tool-gateway
- [2026-08-08-alexeys-macbook-air-2-widget-tool-gateway-kb.md](log/2026-08-08-alexeys-macbook-air-2-widget-tool-gateway-kb.md) — widget-tool-gateway-kb
- [2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md](log/2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md) — widget-assistant-kanban
- [2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md) — web-recorder-standalone
- [2026-08-08-alexeys-macbook-air-2-web-recorder-page.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-page.md) — web-recorder-page
- [2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md) — web-recorder-dns
- [2026-08-08-alexeys-macbook-air-2-web-reader-routing.md](log/2026-08-08-alexeys-macbook-air-2-web-reader-routing.md) — web-reader-routing
- [2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md](log/2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md) — web-preview-element-context
- [2026-08-08-alexeys-macbook-air-2-release-commit-task-metadata.md](log/2026-08-08-alexeys-macbook-air-2-release-commit-task-metadata.md) — release-commit-task-metadata
- [2026-08-08-alexeys-macbook-air-2-preview-web-scenarios.md](log/2026-08-08-alexeys-macbook-air-2-preview-web-scenarios.md) — preview-web-scenarios

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

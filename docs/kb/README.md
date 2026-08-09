<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 50 коммит(ов) в areas после сверки: 345c7ef feat: serve web recorder in production … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 17 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-08 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-09 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 12 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 22 коммит(ов) в areas после сверки: 345c7ef feat: serve web recorder in production … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 163 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 4 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 2 коммит(ов) в areas после сверки: a1858af feat: add universal widget tool gateway … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-09 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 9 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 3 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-08 | ⚠ 10 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 6 коммит(ов) в areas после сверки: 345c7ef feat: serve web recorder in production … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-09 | ⚠ 1 коммит(ов) в areas после сверки: 9655738 feat: add workflow stages and per-stage LLM selection |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-09, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 149. Последние:

- [2026-08-09-alexeys-macbook-air-2-web-reader-fullscreen.md](log/2026-08-09-alexeys-macbook-air-2-web-reader-fullscreen.md) — web-reader-fullscreen
- [2026-08-09-2470-com-workflow-stage-llm.md](log/2026-08-09-2470-com-workflow-stage-llm.md) — workflow-stage-llm
- [2026-08-08-alexeys-macbook-air-2-widget-tool-gateway.md](log/2026-08-08-alexeys-macbook-air-2-widget-tool-gateway.md) — widget-tool-gateway
- [2026-08-08-alexeys-macbook-air-2-widget-tool-gateway-kb.md](log/2026-08-08-alexeys-macbook-air-2-widget-tool-gateway-kb.md) — widget-tool-gateway-kb
- [2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md](log/2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md) — widget-assistant-kanban
- [2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md) — web-recorder-standalone
- [2026-08-08-alexeys-macbook-air-2-web-recorder-page.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-page.md) — web-recorder-page
- [2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md) — web-recorder-dns
- [2026-08-08-alexeys-macbook-air-2-web-reader-routing.md](log/2026-08-08-alexeys-macbook-air-2-web-reader-routing.md) — web-reader-routing
- [2026-08-08-alexeys-macbook-air-2-web-reader-independent-tab.md](log/2026-08-08-alexeys-macbook-air-2-web-reader-independent-tab.md) — web-reader-independent-tab

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

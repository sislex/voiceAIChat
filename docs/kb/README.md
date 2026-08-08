<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 47 коммит(ов) в areas после сверки: d6cbf22 feat: persist kanban assistant chat with LLM inheritance … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-06 | ⚠ 14 коммит(ов) в areas после сверки: d6cbf22 feat: persist kanban assistant chat with LLM inheritance … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-07 | ⚠ 7 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-08 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-07 | ⚠ 8 коммит(ов) в areas после сверки: d6cbf22 feat: persist kanban assistant chat with LLM inheritance … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 20 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 144 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: aa6ac12 fix(ci): увеличить таймаут актуализации базы знаний … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 1 коммит(ов) в areas после сверки: d6cbf22 feat: persist kanban assistant chat with LLM inheritance |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-07 | ⚠ 2 коммит(ов) в areas после сверки: a62f5ad chatai-141: управление открытым сайтом и чтение DOM из чата … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-08 | ⚠ 1 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-08 | ⚠ 3 коммит(ов) в areas после сверки: 9614b83 fix: restore web recorder preview loading … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-08 | ⚠ 2 коммит(ов) в areas после сверки: 9614b83 fix: restore web recorder preview loading … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-08 | ⚠ 4 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-07 | ⚠ 4 коммит(ов) в areas после сверки: 12232f7 feat: extract web recorder app … |
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

Всего записей: 135. Последние:

- [2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md](log/2026-08-08-alexeys-macbook-air-2-widget-assistant-kanban.md) — widget-assistant-kanban
- [2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-standalone.md) — web-recorder-standalone
- [2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md](log/2026-08-08-alexeys-macbook-air-2-web-recorder-dns.md) — web-recorder-dns
- [2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md](log/2026-08-08-alexeys-macbook-air-2-web-preview-element-context.md) — web-preview-element-context
- [2026-08-08-alexeys-macbook-air-2-preview-web-scenarios.md](log/2026-08-08-alexeys-macbook-air-2-preview-web-scenarios.md) — preview-web-scenarios
- [2026-08-08-alexeys-macbook-air-2-preview-proxy.md](log/2026-08-08-alexeys-macbook-air-2-preview-proxy.md) — preview-proxy
- [2026-08-08-alexeys-macbook-air-2-preview-inspector.md](log/2026-08-08-alexeys-macbook-air-2-preview-inspector.md) — preview-inspector
- [2026-08-08-alexeys-macbook-air-2-preview-cookie-ensure.md](log/2026-08-08-alexeys-macbook-air-2-preview-cookie-ensure.md) — preview-cookie-ensure
- [2026-08-08-alexeys-macbook-air-2-preview-cookie-auth.md](log/2026-08-08-alexeys-macbook-air-2-preview-cookie-auth.md) — preview-cookie-auth
- [2026-08-08-alexeys-macbook-air-2-preview-browser-actions.md](log/2026-08-08-alexeys-macbook-air-2-preview-browser-actions.md) — preview-browser-actions

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 110 коммит(ов) в areas после сверки: 4163f0b feat(qa): automate integration test stage … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 4 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-13 | ⚠ код изменён 2026-08-15, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ код изменён 2026-08-15, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-15 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-14 | ⚠ код изменён 2026-08-15, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-13 | ⚠ 30 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 56 коммит(ов) в areas после сверки: 4163f0b feat(qa): automate integration test stage … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-15 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-14 | ⚠ код изменён 2026-08-15, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-15 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 349 коммит(ов) в areas после сверки: ed88f1a Merge task 29165873-b1c1-4cb7-8527-ae6581461802 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-15 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ код изменён 2026-08-15, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-13 | ⚠ 3 коммит(ов) в areas после сверки: 9b5cd4c feat: complete manual QA workflow … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 13 коммит(ов) в areas после сверки: 056f5c7 fix(chat): publish queued messages in turn order … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 48 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-15 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 43 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-15 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ✓ |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-14 | ⚠ код изменён 2026-08-15, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-15 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-15, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/browser-runner](../../apps/browser-runner/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 218. Последние:

- [2026-08-15-mac-web-reader-chat-list.md](log/2026-08-15-mac-web-reader-chat-list.md) — Web Reader — независимый список чатов и детерминированное создание
- [2026-08-15-mac-preview-proxy-network-shim.md](log/2026-08-15-mac-preview-proxy-network-shim.md) — preview-proxy-network-shim
- [2026-08-15-mac-preparation-tab-navigation.md](log/2026-08-15-mac-preparation-tab-navigation.md) — preparation-tab-navigation
- [2026-08-15-mac-integration-test-stage.md](log/2026-08-15-mac-integration-test-stage.md) — integration-test-stage
- [2026-08-15-2470-com-playwright-reader-и-browser-runner.md](log/2026-08-15-2470-com-playwright-reader-и-browser-runner.md) — Playwright Reader и browser-runner — первый срез
- [2026-08-14-mac-ui-board-fixtures-canonical-columns.md](log/2026-08-14-mac-ui-board-fixtures-canonical-columns.md) — ui-board-fixtures-canonical-columns
- [2026-08-14-mac-qa-stage-runs.md](log/2026-08-14-mac-qa-stage-runs.md) — qa-stage-runs
- [2026-08-14-mac-component-qa-test-stages.md](log/2026-08-14-mac-component-qa-test-stages.md) — component-qa-test-stages
- [2026-08-14-mac-component-qa-automation.md](log/2026-08-14-mac-component-qa-automation.md) — component-qa-automation
- [2026-08-14-mac-autostart-development-run.md](log/2026-08-14-mac-autostart-development-run.md) — autostart-development-run

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

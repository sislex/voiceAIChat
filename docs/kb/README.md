<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 11 коммит(ов) в areas после сверки: 259877e fix(kb): авто-инъекция не молчит на кодовых описаниях задач … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-01 | ⚠ 8 коммит(ов) в areas после сверки: 9557f8e test(ci): расход стадии проверяется на ходах с usage; патч стадий сливается с текущими … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-02 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-02 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: c2d0836 feat(ci): модель по стадии рана — актуализация БЗ и резюме дешевле |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 3 коммит(ов) в areas после сверки: dc53e1e docs(kb): модель по стадии рана и замер opus против sonnet на шаге БЗ … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-01 | ⚠ 2 коммит(ов) в areas после сверки: 9c3ab50 feat(llm-runner): каркас исполнителя LLM — apps/llm-runner и POST /v1/run … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: 259877e fix(kb): авто-инъекция не молчит на кодовых описаниях задач |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-02 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-01 | ⚠ 15 коммит(ов) в areas после сверки: 9557f8e test(ci): расход стадии проверяется на ходах с usage; патч стадий сливается с текущими … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: c2d0836 feat(ci): модель по стадии рана — актуализация БЗ и резюме дешевле |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-01 | ⚠ 25 коммит(ов) в areas после сверки: 9557f8e test(ci): расход стадии проверяется на ходах с usage; патч стадий сливается с текущими … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-02 | ⚠ 3 коммит(ов) в areas после сверки: c2d0836 feat(ci): модель по стадии рана — актуализация БЗ и резюме дешевле … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: dc53e1e docs(kb): модель по стадии рана и замер opus против sonnet на шаге БЗ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-02 | ⚠ 4 коммит(ов) в areas после сверки: a91b61c style(ui): отступы JSX селектора модели стадии … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-02, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |

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

Всего записей: 69. Последние:

- [2026-08-02-alexeys-macbook-air-2-run-body-contract.md](log/2026-08-02-alexeys-macbook-air-2-run-body-contract.md) — run-body-contract
- [2026-08-02-alexeys-macbook-air-2-mcp-public-base.md](log/2026-08-02-alexeys-macbook-air-2-mcp-public-base.md) — mcp-public-base
- [2026-08-02-2470-com-пересборка-прода-chat-67.md](log/2026-08-02-2470-com-пересборка-прода-chat-67.md) — пересборка-прода-chat-67
- [2026-08-02-2470-com-пересборка-прода-chat-67-kb.md](log/2026-08-02-2470-com-пересборка-прода-chat-67-kb.md) — пересборка-прода-chat-67-kb
- [2026-08-02-2470-com-модель-по-стадии-рана.md](log/2026-08-02-2470-com-модель-по-стадии-рана.md) — модель-по-стадии-рана
- [2026-08-02-2470-com-windows-msys-paths-fs.md](log/2026-08-02-2470-com-windows-msys-paths-fs.md) — windows-msys-paths-fs
- [2026-08-02-2470-com-ui-chat-mode-and-model-menus.md](log/2026-08-02-2470-com-ui-chat-mode-and-model-menus.md) — ui-chat-mode-and-model-menus
- [2026-08-02-2470-com-pricing-opus-3x.md](log/2026-08-02-2470-com-pricing-opus-3x.md) — pricing-opus-3x
- [2026-08-02-2470-com-kb-инъекция-на-кодовых-описаниях.md](log/2026-08-02-2470-com-kb-инъекция-на-кодовых-описаниях.md) — kb-инъекция-на-кодовых-описаниях
- [2026-08-02-2470-com-ci-usage-tools-allowlist.md](log/2026-08-02-2470-com-ci-usage-tools-allowlist.md) — ci-usage-tools-allowlist

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

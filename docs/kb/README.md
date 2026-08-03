<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 12 коммит(ов) в areas после сверки: fc1eef3 fix(llm): fallback для офлайн-машин и общий Codex-профиль … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 6 коммит(ов) в areas после сверки: 65621d2 feat(ui): режим чата в карточке сайдбара + актуальные меню моделей Claude/Codex … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-01 | ⚠ 13 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: fc1eef3 fix(llm): fallback для офлайн-машин и общий Codex-профиль |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-03 | ⚠ 3 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-03 | ⚠ 4 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: fc1eef3 fix(llm): fallback для офлайн-машин и общий Codex-профиль |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 9 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-03 | ⚠ 1 коммит(ов) в areas после сверки: 01f86f6 feat(kb): пробел базы знаний обязан стать записью |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-03 | ⚠ 3 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-02 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-01 | ⚠ 20 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-02 | ⚠ 1 коммит(ов) в areas после сверки: c2d0836 feat(ci): модель по стадии рана — актуализация БЗ и резюме дешевле |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-01 | ⚠ 31 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-02 | ⚠ 6 коммит(ов) в areas после сверки: ea86924 Merge branch 'feature/80-обязательное-пополнение-бз-после-пробела' … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-02 | ⚠ 2 коммит(ов) в areas после сверки: fc1eef3 fix(llm): fallback для офлайн-машин и общий Codex-профиль … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-02 | ⚠ 5 коммит(ов) в areas после сверки: fc1eef3 fix(llm): fallback для офлайн-машин и общий Codex-профиль … |
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

Всего записей: 72. Последние:

- [2026-08-03-2470-com-обязательное-пополнение-бз.md](log/2026-08-03-2470-com-обязательное-пополнение-бз.md) — обязательное-пополнение-бз
- [2026-08-03-2470-com-ci-runner.md](log/2026-08-03-2470-com-ci-runner.md) — ci-runner
- [2026-08-02-alexeys-macbook-air-2-run-body-contract.md](log/2026-08-02-alexeys-macbook-air-2-run-body-contract.md) — run-body-contract
- [2026-08-02-alexeys-macbook-air-2-mcp-public-base.md](log/2026-08-02-alexeys-macbook-air-2-mcp-public-base.md) — mcp-public-base
- [2026-08-02-2470-com-пересборка-прода-chat-71.md](log/2026-08-02-2470-com-пересборка-прода-chat-71.md) — пересборка-прода-chat-71
- [2026-08-02-2470-com-пересборка-прода-chat-67.md](log/2026-08-02-2470-com-пересборка-прода-chat-67.md) — пересборка-прода-chat-67
- [2026-08-02-2470-com-пересборка-прода-chat-67-kb.md](log/2026-08-02-2470-com-пересборка-прода-chat-67-kb.md) — пересборка-прода-chat-67-kb
- [2026-08-02-2470-com-модель-по-стадии-рана.md](log/2026-08-02-2470-com-модель-по-стадии-рана.md) — модель-по-стадии-рана
- [2026-08-02-2470-com-windows-msys-paths-fs.md](log/2026-08-02-2470-com-windows-msys-paths-fs.md) — windows-msys-paths-fs
- [2026-08-02-2470-com-ui-chat-mode-and-model-menus.md](log/2026-08-02-2470-com-ui-chat-mode-and-model-menus.md) — ui-chat-mode-and-model-menus

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

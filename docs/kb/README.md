<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 18 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 27 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-29 | ⚠ 2 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-23 | ⚠ 30 коммит(ов) в areas после сверки: a5803690 feat(deploy): environment observe/apply scripts; deploy keeps environment switches … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 6 коммит(ов) в areas после сверки: aab77dd8 feat(make): bind a Web Reader or Playwright browser session to Make chats … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-02 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-01 | ⚠ 6 коммит(ов) в areas после сверки: 5fd159ef test(tooling): protected fixtures under the delivery attempt root … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 27 коммит(ов) в areas после сверки: 444ba42d chore: consume Kanban 0.1.1 from GHCR … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 28 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 260 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 410 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 46 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 1 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 44 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 5 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 20 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1716 коммит(ов) в areas после сверки: a5803690 feat(deploy): environment observe/apply scripts; deploy keeps environment switches … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 81 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 3 коммит(ов) в areas после сверки: 539581e9 fix(gate): lead full-plan reasons with the changed Core code … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 53 коммит(ов) в areas после сверки: 539581e9 fix(gate): lead full-plan reasons with the changed Core code … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 33 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 54 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 422 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-29 | ⚠ 2 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ⚠ 3 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-22 | ⚠ 33 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ⚠ 4 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-30 | ⚠ 3 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-28 | ⚠ 28 коммит(ов) в areas после сверки: 58949f55 test(server): use temporary runner contract fixture directory … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-28 | ⚠ 18 коммит(ов) в areas после сверки: a68adcad test(e2e): Core + Kanban stand for project page e2e … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 251 коммит(ов) в areas после сверки: 444ba42d chore: consume Kanban 0.1.1 from GHCR … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-30 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 203 коммит(ов) в areas после сверки: 444ba42d chore: consume Kanban 0.1.1 from GHCR … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ⚠ 9 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 995. Последние:

- [2026-10-02-alexeys-macbook-air-2-environments-b01-review.md](log/2026-10-02-alexeys-macbook-air-2-environments-b01-review.md) — environments-b01-review
- [2026-10-01-alexeys-macbook-air-2-release-retention.md](log/2026-10-01-alexeys-macbook-air-2-release-retention.md) — release-retention
- [2026-10-01-alexeys-macbook-air-2-kanban-linux-image-pin.md](log/2026-10-01-alexeys-macbook-air-2-kanban-linux-image-pin.md) — kanban-linux-image-pin
- [2026-10-01-alexeys-macbook-air-2-kanban-e2e-stand.md](log/2026-10-01-alexeys-macbook-air-2-kanban-e2e-stand.md) — kanban-e2e-stand
- [2026-09-30-alexeys-macbook-air-2-restore-core-owned-tests.md](log/2026-09-30-alexeys-macbook-air-2-restore-core-owned-tests.md) — restore-core-owned-tests
- [2026-09-30-alexeys-macbook-air-2-remove-embedded-kanban.md](log/2026-09-30-alexeys-macbook-air-2-remove-embedded-kanban.md) — remove-embedded-kanban
- [2026-09-30-alexeys-macbook-air-2-pin-combined-make-1-3-1.md](log/2026-09-30-alexeys-macbook-air-2-pin-combined-make-1-3-1.md) — pin-combined-make-1-3-1
- [2026-09-30-alexeys-macbook-air-2-make-quotas-1-3-1.md](log/2026-09-30-alexeys-macbook-air-2-make-quotas-1-3-1.md) — make-quotas-1-3-1
- [2026-09-30-alexeys-macbook-air-2-make-preview-token-routing.md](log/2026-09-30-alexeys-macbook-air-2-make-preview-token-routing.md) — make-preview-token-routing
- [2026-09-30-alexeys-macbook-air-2-kanban-owner-ui-pin.md](log/2026-09-30-alexeys-macbook-air-2-kanban-owner-ui-pin.md) — kanban-owner-ui-pin

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

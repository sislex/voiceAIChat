<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 141 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 155 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-27 | ⚠ 2 коммит(ов) в areas после сверки: a083faae feat(projects): свой проект создаёт любой пользователь + почта для dev … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-30 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-29 | ⚠ 23 коммит(ов) в areas после сверки: 27b15e3c feat(reader): из записи получается тест, а не список кликов … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-30 | ⚠ 1 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-29 | ⚠ 24 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 35 коммит(ов) в areas после сверки: 6beb884a feat(browser-runner): доверять внутреннему CA стенда — Playwright Reader открывает наш сайт … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 59 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 91 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-24 | ⚠ 118 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-24 | ⚠ 124 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-30 | ⚠ 2 коммит(ов) в areas после сверки: f971fc33 fix(browser-runner): починить typecheck и перестать объявлять гейт зелёным по выводу … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 860 коммит(ов) в areas после сверки: f971fc33 fix(browser-runner): починить typecheck и перестать объявлять гейт зелёным по выводу … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-30 | ⚠ 8 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-29 | ⚠ 24 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-08-29 | ⚠ 10 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-28 | ⚠ 58 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 127 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 7 коммит(ов) в areas после сверки: c4449b30 docs(kb): прод-чекаут — не target.path, и состояние почты на проде … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-27 | ⚠ 36 коммит(ов) в areas после сверки: 44ad953c CHAT-376 make Reader updates live and observable … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-28 | ⚠ 58 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 102 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-29 | ⚠ 12 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-29 | ⚠ 19 коммит(ов) в areas после сверки: 27b15e3c feat(reader): из записи получается тест, а не список кликов … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-28 | ⚠ 51 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-29 | ⚠ 31 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 94 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 2 коммит(ов) в areas после сверки: b1ce0a93 fix(dev): порты dev-сеанса из окружения — второй чекаут поднимается рядом с первым … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-30 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 47 коммит(ов) в areas после сверки: 6fac734c refactor(scenario): один исполнитель шага вместо двух; прогон прямо в панели … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-30 | ⚠ 3 коммит(ов) в areas после сверки: c1975fe6 fix(scenario): ожидания догоняют страницу; проверка сценария до сохранения … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-30, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 418. Последние:

- [2026-08-30-alexeys-macbook-air-2-parallel-worktree.md](log/2026-08-30-alexeys-macbook-air-2-parallel-worktree.md) — parallel-worktree
- [2026-08-30-alexeys-macbook-air-2-parallel-checkouts-3.md](log/2026-08-30-alexeys-macbook-air-2-parallel-checkouts-3.md) — parallel-checkouts-3
- [2026-08-29-macbook-air-user-restore-chat-make-css-invariants.md](log/2026-08-29-macbook-air-user-restore-chat-make-css-invariants.md) — restore-chat-make-css-invariants
- [2026-08-29-germany-4-8-60-task-autopilot.md](log/2026-08-29-germany-4-8-60-task-autopilot.md) — task-autopilot
- [2026-08-29-germany-4-8-60-password-reset-email.md](log/2026-08-29-germany-4-8-60-password-reset-email.md) — password-reset-email
- [2026-08-29-germany-4-8-60-login-new-device-email.md](log/2026-08-29-germany-4-8-60-login-new-device-email.md) — login-new-device-email
- [2026-08-29-germany-4-8-60-invite-email.md](log/2026-08-29-germany-4-8-60-invite-email.md) — invite-email
- [2026-08-29-alexeys-macbook-air-2-task-card-stages.md](log/2026-08-29-alexeys-macbook-air-2-task-card-stages.md) — task-card-stages
- [2026-08-29-alexeys-macbook-air-2-restart-reconcile.md](log/2026-08-29-alexeys-macbook-air-2-restart-reconcile.md) — restart-reconcile
- [2026-08-29-alexeys-macbook-air-2-reader-live-actions.md](log/2026-08-29-alexeys-macbook-air-2-reader-live-actions.md) — reader-live-actions

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

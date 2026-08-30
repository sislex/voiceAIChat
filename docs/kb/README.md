<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 150 коммит(ов) в areas после сверки: dcc67f26 feat(settings): вернувшийся сервер подхватывается сам, патч в полёте не затирается … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 160 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-27 | ⚠ 2 коммит(ов) в areas после сверки: a083faae feat(projects): свой проект создаёт любой пользователь + почта для dev … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-30 | ⚠ 2 коммит(ов) в areas после сверки: 451dd6eb feat(qa-stage): сквозная проверка серверного пути; DNS-сбой отличается от запрета … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-30 | ⚠ 4 коммит(ов) в areas после сверки: 3fce54fa feat(settings): защита настроек в глубину — санитайзер, откат, синхронизация вкладок … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-30 | ⚠ 4 коммит(ов) в areas после сверки: b55d5977 feat(qa): десять правок разового прогона, ошибок страницы и редактора … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-29 | ⚠ 53 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-28 | ⚠ 39 коммит(ов) в areas после сверки: bdd6d8e3 fix(preview): уникальное имя временного файла хранилища превью … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 71 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 94 коммит(ов) в areas после сверки: b55d5977 feat(qa): десять правок разового прогона, ошибок страницы и редактора … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-24 | ⚠ 126 коммит(ов) в areas после сверки: 2d656f2b Merge remote-tracking branch 'origin/main' … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-24 | ⚠ 139 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-30 | ⚠ 5 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 893 коммит(ов) в areas после сверки: dcc67f26 feat(settings): вернувшийся сервер подхватывается сам, патч в полёте не затирается … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-30 | ⚠ 22 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-29 | ⚠ 51 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-08-29 | ⚠ 19 коммит(ов) в areas после сверки: 318c94ac Merge remote-tracking branch 'origin/main' … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-28 | ⚠ 72 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 137 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 8 коммит(ов) в areas после сверки: 002085de feat(gate): одна честная команда проверки; молчаливые сбои стали заметны … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-27 | ⚠ 41 коммит(ов) в areas после сверки: dcc67f26 feat(settings): вернувшийся сервер подхватывается сам, патч в полёте не затирается … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-28 | ⚠ 67 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 110 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-30 | ⚠ 28 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-29 | ⚠ 26 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-30 | ⚠ 8 коммит(ов) в areas после сверки: 32349f49 Merge remote-tracking branch 'origin/main' into work2 … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-30 | ⚠ 15 коммит(ов) в areas после сверки: dcc67f26 feat(settings): вернувшийся сервер подхватывается сам, патч в полёте не затирается … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 97 коммит(ов) в areas после сверки: b55d5977 feat(qa): десять правок разового прогона, ошибок страницы и редактора … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 2 коммит(ов) в areas после сверки: b1ce0a93 fix(dev): порты dev-сеанса из окружения — второй чекаут поднимается рядом с первым … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-30 | ⚠ 5 коммит(ов) в areas после сверки: b55d5977 feat(qa): десять правок разового прогона, ошибок страницы и редактора … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 50 коммит(ов) в areas после сверки: b55d5977 feat(qa): десять правок разового прогона, ошибок страницы и редактора … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-30 | ✓ |
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

Всего записей: 435. Последние:

- [2026-08-30-alexeys-macbook-air-2-ten-improvements.md](log/2026-08-30-alexeys-macbook-air-2-ten-improvements.md) — ten-improvements
- [2026-08-30-alexeys-macbook-air-2-task-card-tabs-round2.md](log/2026-08-30-alexeys-macbook-air-2-task-card-tabs-round2.md) — task-card-tabs-round2
- [2026-08-30-alexeys-macbook-air-2-task-card-feeds-round1.md](log/2026-08-30-alexeys-macbook-air-2-task-card-feeds-round1.md) — task-card-feeds-round1
- [2026-08-30-alexeys-macbook-air-2-tablet-and-carets-round9.md](log/2026-08-30-alexeys-macbook-air-2-tablet-and-carets-round9.md) — tablet-and-carets-round9
- [2026-08-30-alexeys-macbook-air-2-settings-survive-deploy.md](log/2026-08-30-alexeys-macbook-air-2-settings-survive-deploy.md) — Настройки пользователя после релиза и деплоя
- [2026-08-30-alexeys-macbook-air-2-run-feed-ansi-round3.md](log/2026-08-30-alexeys-macbook-air-2-run-feed-ansi-round3.md) — run-feed-ansi-round3
- [2026-08-30-alexeys-macbook-air-2-qa-settings-labels-round4.md](log/2026-08-30-alexeys-macbook-air-2-qa-settings-labels-round4.md) — qa-settings-labels-round4
- [2026-08-30-alexeys-macbook-air-2-preparation-tab-round5.md](log/2026-08-30-alexeys-macbook-air-2-preparation-tab-round5.md) — preparation-tab-round5
- [2026-08-30-alexeys-macbook-air-2-parallel-worktree.md](log/2026-08-30-alexeys-macbook-air-2-parallel-worktree.md) — parallel-worktree
- [2026-08-30-alexeys-macbook-air-2-parallel-checkouts-3.md](log/2026-08-30-alexeys-macbook-air-2-parallel-checkouts-3.md) — parallel-checkouts-3

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-29, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 12 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-29 | ⚠ 2 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 13 коммит(ов) в areas после сверки: d999086c chore(ui): pin Core UI 1.5.32 (Android app download in Machines) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-10-29 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-29 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-29 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-29 | ⚠ 8 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e2 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 524 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-24 | ⚠ 12 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 1009 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 409 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 515 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 809 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-24 | ⚠ 12 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ⚠ 7 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 114 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1104 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 70 коммит(ов) в areas после сверки: 3c98193c fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 41 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 672 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-29, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 2 коммит(ов) в areas после сверки: 3c98193c fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 127 коммит(ов) в areas после сверки: 3c98193c fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-29 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-29 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ⚠ 9 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-27 | ⚠ 5 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-29 | ⚠ 3 коммит(ов) в areas после сверки: bdb94391 Enable scoped Make machine access and attachment transfers … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ⚠ 16 коммит(ов) в areas после сверки: 4caacd9a Merge dev into SISL-790 (task a2054cc0-353b-4547-8ace-264ed7c02163) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-29 | ⚠ 13 коммит(ов) в areas после сверки: 27ddd335 Merge dev into SISL-793 (Kanban 0.2.53 pin) … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1325. Последние:

- [2026-10-29-pc-radvilovich-tailae39a6-ts-net-sisl791-stand-diagnostics.md](log/2026-10-29-pc-radvilovich-tailae39a6-ts-net-sisl791-stand-diagnostics.md) — sisl791-stand-diagnostics
- [2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-apk-distribution.md](log/2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-apk-distribution.md) — android-apk-distribution
- [2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-agent-auto-update.md](log/2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-agent-auto-update.md) — android-agent-auto-update
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-sisl-794-kb-reconcile.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-sisl-794-kb-reconcile.md) — sisl-794-kb-reconcile
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-health-validation.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-health-validation.md) — release-train-health-validation
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-health-retries.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-health-retries.md) — release-train-health-retries
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c6077abb-5f8d-404f-b078-6c33ffa974df.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c6077abb-5f8d-404f-b078-6c33ffa974df.md) — release-train-c6077abb-5f8d-404f-b078-6c33ffa974df
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c0568900-fb04-4678-a8e4-663e9a1cea8f.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c0568900-fb04-4678-a8e4-663e9a1cea8f.md) — release-train-c0568900-fb04-4678-a8e4-663e9a1cea8f
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-9368cd51-13a3-49cc-b9b4-70d50694bdd8.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-9368cd51-13a3-49cc-b9b4-70d50694bdd8.md) — release-train-9368cd51-13a3-49cc-b9b4-70d50694bdd8
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-26e9a829-e0ac-4eb2-966b-8502b3e339cd.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-26e9a829-e0ac-4eb2-966b-8502b3e339cd.md) — release-train-26e9a829-e0ac-4eb2-966b-8502b3e339cd

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

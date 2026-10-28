<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-28, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 9 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-27 | ⚠ 1 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 9 коммит(ов) в areas после сверки: 9f113857 chore: pin Kanban 0.2.42 and Core UI 1.5.31 (local-stand, thin client) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ код изменён 2026-10-27, сверка 2026-09-29 (по датам: правки того же дня не видны — поставь checked) |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-28 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-28 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-27 | ⚠ 4 коммит(ов) в areas после сверки: 201b069b Merge dev into SISL-768 (task e973148f-31eb-4a70-b49e-8ab1d8b32104) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ код изменён 2026-10-15, сверка 2026-09-17 (по датам: правки того же дня не видны — поставь checked) |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ код изменён 2026-10-27, сверка 2026-09-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-24 | ⚠ 8 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ код изменён 2026-10-28, сверка 2026-08-28 (по датам: правки того же дня не видны — поставь checked) |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ код изменён 2026-10-28, сверка 2026-09-12 (по датам: правки того же дня не видны — поставь checked) |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ код изменён 2026-10-28, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ код изменён 2026-10-28, сверка 2026-09-17 (по датам: правки того же дня не видны — поставь checked) |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-24 | ⚠ 8 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ⚠ 6 коммит(ов) в areas после сверки: b63971f4 Merge dev into SISL-783 (task 34ced7e4-a7cc-4c2b-9041-560e800d7670) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 85 коммит(ов) в areas после сверки: 8b7b5e49 docs(kb): update after merge e973148f-31eb-4a70-b49e-8ab1d8b32104 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ код изменён 2026-10-28, сверка 2026-09-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ код изменён 2026-10-26, сверка 2026-09-30 (по датам: правки того же дня не видны — поставь checked) |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 29 коммит(ов) в areas после сверки: 201b069b Merge dev into SISL-768 (task e973148f-31eb-4a70-b49e-8ab1d8b32104) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ код изменён 2026-10-27, сверка 2026-09-16 (по датам: правки того же дня не видны — поставь checked) |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-28, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 2 коммит(ов) в areas после сверки: 3c98193c fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ код изменён 2026-10-26, сверка 2026-10-05 (по датам: правки того же дня не видны — поставь checked) |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-28 | ⚠ 1 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-20 | ⚠ 15 коммит(ов) в areas после сверки: 50e092a9 Merge dev into SK-93 (task 58bc4237-d6eb-4ee2-bb93-aba3bc9ea83b) … |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ⚠ 8 коммит(ов) в areas после сверки: b63971f4 Merge dev into SISL-783 (task 34ced7e4-a7cc-4c2b-9041-560e800d7670) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-27 | ⚠ 1 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-27 | ⚠ 12 коммит(ов) в areas после сверки: f4ae87c5 fix(core): bound upload abuse and verify public auth limits … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ⚠ 13 коммит(ов) в areas после сверки: c29bd3e2 Merge dev into SCU-25 (task b9f254f4-4670-4aa4-b894-a0836b9af17a) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-28 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1305. Последние:

- [2026-10-28-pc-radvilovich-tailae39a6-ts-net-release-train-resume-owner-source.md](log/2026-10-28-pc-radvilovich-tailae39a6-ts-net-release-train-resume-owner-source.md) — release-train-resume-owner-source
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-sisl-766-runner-lifetime.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-sisl-766-runner-lifetime.md) — sisl-766-runner-lifetime
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7.md) — release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-public-abuse-limits.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-public-abuse-limits.md) — public-abuse-limits
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-chat-only-ui-test-map.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-chat-only-ui-test-map.md) — chat-only-ui-test-map
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-chat-only-ui-acceptance.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-chat-only-ui-acceptance.md) — chat-only-ui-acceptance
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-accounting-runner-cleanup.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-accounting-runner-cleanup.md) — accounting-runner-cleanup
- [2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-reset-usage-validation.md](log/2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-reset-usage-validation.md) — thread-reset-usage-validation
- [2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-reset-compatibility.md](log/2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-reset-compatibility.md) — thread-reset-compatibility
- [2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-cost-reset.md](log/2026-10-27-pc-radvilovich-tailae39a6-ts-net-thread-cost-reset.md) — thread-cost-reset

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

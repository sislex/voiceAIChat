<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-28, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 11 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-27 | ⚠ 3 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 11 коммит(ов) в areas после сверки: 5dc2eb409 fix(components): enable scheduled renewal and verify expired grant recovery … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 657 коммит(ов) в areas после сверки: c29bd3e26 Merge dev into SCU-25 (task b9f254f4-4670-4aa4-b894-a0836b9af17a) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-28 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-29 | ⚠ 3 коммит(ов) в areas после сверки: 2f711fadb Merge pull request #808 from sislex/fix/stand-scrypt-libressl … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-27 | ⚠ 9 коммит(ов) в areas после сверки: a484130b2 Pin release train c6077abb-5f8d-404f-b078-6c33ffa974df … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e20 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 523 коммит(ов) в areas после сверки: 207281ffd fix(agents): offer supervised Android updates on registration … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-24 | ⚠ 10 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 1008 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 408 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 514 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 807 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-24 | ⚠ 10 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ⚠ 6 коммит(ов) в areas после сверки: b63971f43 Merge dev into SISL-783 (task 34ced7e4-a7cc-4c2b-9041-560e800d7670) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 93 коммит(ов) в areas после сверки: a484130b2 Pin release train c6077abb-5f8d-404f-b078-6c33ffa974df … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1103 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 70 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 34 коммит(ов) в areas после сверки: a484130b2 Pin release train c6077abb-5f8d-404f-b078-6c33ffa974df … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 671 коммит(ов) в areas после сверки: 97742971a SISL-781: isolate response diagnostics from message history … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-28, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 2 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 127 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-28 | ⚠ 3 коммит(ов) в areas после сверки: e6cdeba01 Merge remote-tracking branch 'origin/dev' into sisl-786-merge … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-29 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ⚠ 8 коммит(ов) в areas после сверки: b63971f43 Merge dev into SISL-783 (task 34ced7e4-a7cc-4c2b-9041-560e800d7670) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-27 | ⚠ 2 коммит(ов) в areas после сверки: 207281ffd fix(agents): offer supervised Android updates on registration … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-29 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ⚠ 14 коммит(ов) в areas после сверки: 207281ffd fix(agents): offer supervised Android updates on registration … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-29 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-29, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-28, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1311. Последние:

- [2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-agent-auto-update.md](log/2026-10-29-pc-radvilovich-tailae39a6-ts-net-android-agent-auto-update.md) — android-agent-auto-update
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c6077abb-5f8d-404f-b078-6c33ffa974df.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-release-train-c6077abb-5f8d-404f-b078-6c33ffa974df.md) — release-train-c6077abb-5f8d-404f-b078-6c33ffa974df
- [2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-browser-gate-short-tmpdir.md](log/2026-10-29-alexeys-macbook-air-tailae39a6-ts-net-browser-gate-short-tmpdir.md) — browser-gate-short-tmpdir
- [2026-10-28-pc-radvilovich-tailae39a6-ts-net-sisl-788-search-diagnostics.md](log/2026-10-28-pc-radvilovich-tailae39a6-ts-net-sisl-788-search-diagnostics.md) — sisl-788-search-diagnostics
- [2026-10-28-pc-radvilovich-tailae39a6-ts-net-sisl-786-universal-search-diagnostics-kb.md](log/2026-10-28-pc-radvilovich-tailae39a6-ts-net-sisl-786-universal-search-diagnostics-kb.md) — sisl-786-universal-search-diagnostics-kb
- [2026-10-28-pc-radvilovich-tailae39a6-ts-net-component-token-auto-renewal.md](log/2026-10-28-pc-radvilovich-tailae39a6-ts-net-component-token-auto-renewal.md) — component-token-auto-renewal
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-sisl-766-runner-lifetime.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-sisl-766-runner-lifetime.md) — sisl-766-runner-lifetime
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-65446cd4-9c6d-417f-a3c9-88a0ab94b700.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-65446cd4-9c6d-417f-a3c9-88a0ab94b700.md) — release-train-65446cd4-9c6d-417f-a3c9-88a0ab94b700
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7.md) — release-train-3f7314f6-67ef-4810-a2da-99473f62f3d7
- [2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-public-abuse-limits.md](log/2026-10-28-alexeys-macbook-air-tailae39a6-ts-net-public-abuse-limits.md) — public-abuse-limits

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

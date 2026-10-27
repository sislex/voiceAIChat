<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-24, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 4 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 9 коммит(ов) в areas после сверки: 9f113857f chore: pin Kanban 0.2.42 and Core UI 1.5.31 (local-stand, thin client) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 647 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-25 | ⚠ 2 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-27 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-24 | ⚠ 11 коммит(ов) в areas после сверки: 9f113857f chore: pin Kanban 0.2.42 and Core UI 1.5.31 (local-stand, thin client) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e20 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 521 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-24 | ⚠ 2 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 1001 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 402 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 505 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 800 коммит(ов) в areas после сверки: 3e3a444b7 Refresh OpenAI model catalog and preserve fractional token prices … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-24 | ⚠ 2 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ⚠ 2 коммит(ов) в areas после сверки: 3e3a444b7 Refresh OpenAI model catalog and preserve fractional token prices … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 49 коммит(ов) в areas после сверки: 234a529e3 Merge remote-tracking branch 'origin/dev' into fix/queue-now-failed … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1097 коммит(ов) в areas после сверки: 3e3a444b7 Refresh OpenAI model catalog and preserve fractional token prices … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 70 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 18 коммит(ов) в areas после сверки: 9f113857f chore: pin Kanban 0.2.42 and Core UI 1.5.31 (local-stand, thin client) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 670 коммит(ов) в areas после сверки: 3e3a444b7 Refresh OpenAI model catalog and preserve fractional token prices … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-25, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 2 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-25, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 127 коммит(ов) в areas после сверки: 3c98193cf fix(gate): npm-script-only package.json edits stay on the quick gate … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-24 | ⚠ 4 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-20 | ⚠ 7 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ⚠ 3 коммит(ов) в areas после сверки: d4c75318b fix(queue): send now retries a failed queued turn … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-27 | ⚠ 1 коммит(ов) в areas после сверки: 7abdcc183 feat(core): cache compressed static assets and enable Caddy encoding |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-27 | ⚠ 2 коммит(ов) в areas после сверки: 234a529e3 Merge remote-tracking branch 'origin/dev' into fix/queue-now-failed … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ⚠ 4 коммит(ов) в areas после сверки: 7c711c679 feat(make): attach Core conversations to Docker-free local-stand environments (SISL-778) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-27, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-27 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-27, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-27, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1280. Последние:

- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-static-response-compression.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-static-response-compression.md) — static-response-compression
- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-static-response-compression-kb.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-static-response-compression-kb.md) — static-response-compression-kb
- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-release-train-from-dev.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-release-train-from-dev.md) — release-train-from-dev
- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-release-train-from-dev-kb.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-release-train-from-dev-kb.md) — release-train-from-dev-kb
- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-queue-now-retries-failed.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-queue-now-retries-failed.md) — queue-now-retries-failed
- [2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-42-core-ui-1-5-31.md](log/2026-10-27-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-42-core-ui-1-5-31.md) — pin-kanban-0-2-42-core-ui-1-5-31
- [2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-quick-gate-root-scripts.md](log/2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-quick-gate-root-scripts.md) — quick-gate-root-scripts
- [2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-make-core-local-stand.md](log/2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-make-core-local-stand.md) — make-core-local-stand
- [2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-dev-stand-shared-db.md](log/2026-10-26-alexeys-macbook-air-tailae39a6-ts-net-dev-stand-shared-db.md) — dev-stand-shared-db
- [2026-10-25-alexeys-macbook-air-tailae39a6-ts-net-openai-catalog-20261025.md](log/2026-10-25-alexeys-macbook-air-tailae39a6-ts-net-openai-catalog-20261025.md) — OpenAI catalog refresh

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

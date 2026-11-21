<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-14 | ⚠ 14 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-19 | ⚠ 24 коммит(ов) в areas после проверенного SHA: 639ea128f chore(ui): pin Core UI 1.5.63 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-14 | ⚠ 13 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-14 | ⚠ 19 коммит(ов) в areas после проверенного SHA: 639ea128f chore(ui): pin Core UI 1.5.63 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-13 | ⚠ 20 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-19 | ⚠ 6 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-21 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-14 | ⚠ 24 коммит(ов) в areas после проверенного SHA: b583320e0 Pin release train bc72462c-a9d0-44c4-98e9-0cb48bfcf07d … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-11-09 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-13 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 3ae3d0648 fix(db): retry Postgres schema init on deadlock and skip a needless exclusive DROP INDEX |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-17 | ⚠ 25 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-17 | ⚠ 25 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-17 | ⚠ 15 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-17 | ⚠ 24 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-14 | ⚠ 15 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-17 | ⚠ 24 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-13 | ⚠ 14 коммит(ов) в areas после проверенного SHA: 4fd684f98 fix(public): queue questions while a stopped answer settles, start chats in Chat, hide the internal KB … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 3508c4444 fix(knowledge): automatic context injection no longer waits for the LLM reranker … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-14 | ⚠ 13 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-13 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-14 | ⚠ 23 коммит(ов) в areas после проверенного SHA: b583320e0 Pin release train bc72462c-a9d0-44c4-98e9-0cb48bfcf07d … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-11-13 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 3ae3d0648 fix(db): retry Postgres schema init on deadlock and skip a needless exclusive DROP INDEX … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-14 | ⚠ 14 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-14 | ⚠ 23 коммит(ов) в areas после проверенного SHA: c65d88954 feat(test-plan): browser test plan per library and an admin route … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-11-13 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-22 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-19 | ⚠ 11 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [modules.md](modules.md) | Module ownership map | 2026-11-14 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-17 | ⚠ 24 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-18 | ⚠ 11 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-21 | ⚠ 3 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-17 | ⚠ 13 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-14 | ⚠ 21 коммит(ов) в areas после проверенного SHA: b583320e0 Pin release train bc72462c-a9d0-44c4-98e9-0cb48bfcf07d … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-11-09 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-21 | ⚠ 4 коммит(ов) в areas после проверенного SHA: b583320e0 Pin release train bc72462c-a9d0-44c4-98e9-0cb48bfcf07d … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-14 | ⚠ 21 коммит(ов) в areas после проверенного SHA: b583320e0 Pin release train bc72462c-a9d0-44c4-98e9-0cb48bfcf07d … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-17 | ⚠ 30 коммит(ов) в areas после проверенного SHA: a57d091a4 feat(model-api): a stopped answer gets its actual cost once the run is settled … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-11-04 | ✓ |

## Инструкции по пакетам

- [apps/automation-runner](../../apps/automation-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/file-storage](../../packages/file-storage/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/knowledge](../../packages/knowledge/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1545. Последние:

- [2026-11-22-alexeys-macbook-air-tailae39a6-ts-net-stopped-run-not-found.md](log/2026-11-22-alexeys-macbook-air-tailae39a6-ts-net-stopped-run-not-found.md) — stopped-run-not-found
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-final-cost.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-final-cost.md) — stopped-answer-final-cost
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stop-cost-fresh-thread.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stop-cost-fresh-thread.md) — stop-cost-fresh-thread
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stand-proxy-host.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-stand-proxy-host.md) — stand-proxy-host
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-release-train-bc72462c-a9d0-44c4-98e9-0cb48bfcf07d.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-release-train-bc72462c-a9d0-44c4-98e9-0cb48bfcf07d.md) — release-train-bc72462c-a9d0-44c4-98e9-0cb48bfcf07d
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-round1-chat-defaults.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-round1-chat-defaults.md) — public-round1-chat-defaults
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-from-dev-identity-ui.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-from-dev-identity-ui.md) — public-from-dev-identity-ui
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-build-from-dev.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-public-build-from-dev.md) — public-build-from-dev
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-pin-identity-billing-storage.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-pin-identity-billing-storage.md) — pin-identity-billing-storage
- [2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-browser-test-plan.md](log/2026-11-21-alexeys-macbook-air-tailae39a6-ts-net-browser-test-plan.md) — browser-test-plan

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

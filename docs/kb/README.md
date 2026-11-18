<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-14 | ⚠ 9 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-19 | ⚠ 7 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-14 | ⚠ 9 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-14 | ⚠ 10 коммит(ов) в areas после проверенного SHA: 3574f0c44 chore(ui): pin Core UI 1.5.58 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-13 | ⚠ 14 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-14 | ⚠ 16 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-19 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-14 | ⚠ 17 коммит(ов) в areas после проверенного SHA: cd9cacc7e Pin release train 34a4cd09-cb9c-4096-a532-1b00863b4297 … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-11-09 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-13 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-17 | ⚠ 16 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-17 | ⚠ 16 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-17 | ⚠ 9 коммит(ов) в areas после проверенного SHA: 5f027265a fix(llm): surface the reason of a failed Claude result and the model API concurrency limit … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-17 | ⚠ 16 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-14 | ⚠ 9 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-17 | ⚠ 15 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-13 | ⚠ 10 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 3508c4444 fix(knowledge): automatic context injection no longer waits for the LLM reranker … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-14 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-13 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-14 | ⚠ 16 коммит(ов) в areas после проверенного SHA: cd9cacc7e Pin release train 34a4cd09-cb9c-4096-a532-1b00863b4297 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-11-13 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-14 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-14 | ⚠ 16 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-11-13 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-19 | ⚠ 1 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-19 | ⚠ 2 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [modules.md](modules.md) | Module ownership map | 2026-11-14 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-17 | ⚠ 15 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-18 | ⚠ 7 коммит(ов) в areas после проверенного SHA: 78ae9f02d feat(model-api): a separate token right for the tool transit; retry a lost Claude session on a stand … |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-19 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-17 | ⚠ 9 коммит(ов) в areas после проверенного SHA: 5f027265a fix(llm): surface the reason of a failed Claude result and the model API concurrency limit … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-14 | ⚠ 16 коммит(ов) в areas после проверенного SHA: cd9cacc7e Pin release train 34a4cd09-cb9c-4096-a532-1b00863b4297 … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-11-09 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-14 | ⚠ 11 коммит(ов) в areas после проверенного SHA: cd9cacc7e Pin release train 34a4cd09-cb9c-4096-a532-1b00863b4297 … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-14 | ⚠ 16 коммит(ов) в areas после проверенного SHA: cd9cacc7e Pin release train 34a4cd09-cb9c-4096-a532-1b00863b4297 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-17 | ⚠ 20 коммит(ов) в areas после проверенного SHA: ede8df4e6 fix(chat): cold-start history ends at the turn's message and keeps stopped answers as stopped … |
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

Всего записей: 1528. Последние:

- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-turn-error-deleted-conversation.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-turn-error-deleted-conversation.md) — turn-error-deleted-conversation
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-tool-transit-token-grant.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-tool-transit-token-grant.md) — tool-transit-token-grant
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-remote-read-attachment.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-remote-read-attachment.md) — remote-read-attachment
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-release-train-34a4cd09-cb9c-4096-a532-1b00863b4297.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-release-train-34a4cd09-cb9c-4096-a532-1b00863b4297.md) — release-train-34a4cd09-cb9c-4096-a532-1b00863b4297
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-model-api-tool-transit.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-model-api-tool-transit.md) — model-api-tool-transit
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-model-api-text-only-with-transit.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-model-api-text-only-with-transit.md) — model-api-text-only-with-transit
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-make-stand-proxy-off-hint.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-make-stand-proxy-off-hint.md) — make-stand-proxy-off-hint
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-compose-tool-transit-flag.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-compose-tool-transit-flag.md) — compose-tool-transit-flag
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-cold-start-history-boundaries.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-cold-start-history-boundaries.md) — cold-start-history-boundaries
- [2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-claude-result-errors.md](log/2026-11-19-alexeys-macbook-air-tailae39a6-ts-net-claude-result-errors.md) — claude-result-errors

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

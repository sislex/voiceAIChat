<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-17 | ⚠ 7 коммит(ов) в areas после проверенного SHA: 93ad9b05f chore(ui): pin Core UI 1.5.55 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-14 | ⚠ 7 коммит(ов) в areas после проверенного SHA: 93ad9b05f chore(ui): pin Core UI 1.5.55 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-13 | ⚠ 6 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-14 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-17 | ⚠ 1 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-14 | ⚠ 6 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-11-09 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-13 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-17 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-17 | ⚠ 5 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-17 | ⚠ 1 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-17 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-17 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-13 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-14 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 3508c4444 fix(knowledge): automatic context injection no longer waits for the LLM reranker … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-14 | ⚠ 1 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-13 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-14 | ⚠ 6 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-11-13 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-14 | ⚠ 1 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-14 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-11-13 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-18 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-17 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [modules.md](modules.md) | Module ownership map | 2026-11-14 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-17 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-17 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-18 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-17 | ⚠ 5 коммит(ов) в areas после проверенного SHA: 343bb9788 fix(chat): atomic mode switch, stopped answer without text, no plan mode in tool-free turn details … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-14 | ⚠ 6 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-11-09 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-14 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 67e91ccee chore(contracts): accept the reviewed Identity 1.6.1 baseline for the Shared archive … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-14 | ⚠ 6 коммит(ов) в areas после проверенного SHA: a1eb1781a perf(chat): reuse a recent fetch of the project copy instead of fetching before every turn … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-17 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 648527a28 Merge pull request #959 from sislex/fix/chat-mode-stop-defects … |
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

Всего записей: 1512. Последние:

- [2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-project-sync-fetch-throttle.md](log/2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-project-sync-fetch-throttle.md) — project-sync-fetch-throttle
- [2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-kb-auto-context-lexical.md](log/2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-kb-auto-context-lexical.md) — kb-auto-context-lexical
- [2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-chat-model-defects.md](log/2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-chat-model-defects.md) — chat-model-defects
- [2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-chat-mode-stop-defects.md](log/2026-11-18-alexeys-macbook-air-tailae39a6-ts-net-chat-mode-stop-defects.md) — chat-mode-stop-defects
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-text-only-system-prompt.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-text-only-system-prompt.md) — text-only-system-prompt
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-without-text.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-without-text.md) — stopped-answer-without-text
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stop-frees-conversation.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stop-frees-conversation.md) — stop-frees-conversation
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-release-train-503e21c3-673d-44dd-a5e8-9c75761c5912.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-release-train-503e21c3-673d-44dd-a5e8-9c75761c5912.md) — release-train-503e21c3-673d-44dd-a5e8-9c75761c5912
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-queue-snapshot-all-scopes.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-queue-snapshot-all-scopes.md) — queue-snapshot-all-scopes
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-pricing-2026-11-17.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-pricing-2026-11-17.md) — pricing-2026-11-17

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

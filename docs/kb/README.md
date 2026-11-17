<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-14 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-17 | ✓ |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-14 | ⚠ 1 коммит(ов) в areas после проверенного SHA: cf240dc27 fix(model-api): finish a run after its caller left so the token slot is released |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-14 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 66ec4973d chore: pin Make 1.8.21 packages (make-ui frontend without crypto.randomUUID on http) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-13 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 2a17a0a5b fix(model-api): Stop before the first text keeps an empty stopped answer … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-14 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 2a17a0a5b fix(model-api): Stop before the first text keeps an empty stopped answer … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-16 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-14 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-11-09 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-13 | ✓ |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-17 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-17 | ✓ |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-17 | ✓ |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-17 | ✓ |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-14 | ✓ |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-17 | ✓ |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-13 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 4f77f28a3 fix(model-api): Stop frees the conversation — the next message starts on a fresh thread |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-14 | ⚠ 1 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-14 | ✓ |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-13 | ✓ |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-14 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-11-13 | ✓ |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-14 | ✓ |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-14 | ⚠ 3 коммит(ов) в areas после проверенного SHA: 2a17a0a5b fix(model-api): Stop before the first text keeps an empty stopped answer … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-11-13 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-17 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-17 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-11-14 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-17 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-17 | ✓ |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-17 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-17 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-14 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-11-09 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-14 | ⚠ 6 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-14 | ⚠ 4 коммит(ов) в areas после проверенного SHA: 002a0e499 fix(deploy): reap orphaned git processes in the Core container … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-17 | ✓ |
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

Всего записей: 1505. Последние:

- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-text-only-system-prompt.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-text-only-system-prompt.md) — text-only-system-prompt
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-without-text.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stopped-answer-without-text.md) — stopped-answer-without-text
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stop-frees-conversation.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-stop-frees-conversation.md) — stop-frees-conversation
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-queue-snapshot-all-scopes.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-queue-snapshot-all-scopes.md) — queue-snapshot-all-scopes
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-model-api-thread-busy-message.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-model-api-thread-busy-message.md) — model-api-thread-busy-message
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-make-text-files.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-make-text-files.md) — make-text-files
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-claude-text-only-no-resume.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-claude-text-only-no-resume.md) — claude-text-only-no-resume
- [2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-chat-plain-answer-storage-error.md](log/2026-11-17-alexeys-macbook-air-tailae39a6-ts-net-chat-plain-answer-storage-error.md) — chat-plain-answer-storage-error
- [2026-11-16-alexeys-macbook-air-tailae39a6-ts-net-core-zombie-git-processes.md](log/2026-11-16-alexeys-macbook-air-tailae39a6-ts-net-core-zombie-git-processes.md) — core-zombie-git-processes
- [2026-11-14-alexeys-macbook-air-tailae39a6-ts-net-stand-start-without-models.md](log/2026-11-14-alexeys-macbook-air-tailae39a6-ts-net-stand-start-without-models.md) — stand-start-without-models

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

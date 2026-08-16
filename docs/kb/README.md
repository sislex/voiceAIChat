<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-01 | ⚠ 115 коммит(ов) в areas после сверки: c744579 Merge task 23e68524-34e9-4d40-a7da-0f43eb2a9670 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 183a5f6 feat: add structured manual QA workflow … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 4 коммит(ов) в areas после сверки: 8e8e1e9 CHAT-233: add Playwright Reader foundation … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: ffec1df Merge task 30ed1bce-1824-46ed-9eba-285b59eed044 … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-14 | ⚠ код изменён 2026-08-16, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-17 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: c744579 Merge task 23e68524-34e9-4d40-a7da-0f43eb2a9670 … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-13 | ⚠ код изменён 2026-08-17, сверка 2026-08-13 (по датам: правки того же дня не видны — поставь checked) |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-02 | ⚠ 57 коммит(ов) в areas после сверки: 6e34b72 feat(preparation): движок и модель подготовки из настроек этапа … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-17 | ⚠ 8 коммит(ов) в areas после сверки: 206a890 Merge task 0dfeebbd-8d46-4a4e-9e77-850f55c0c55c … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-16 | ⚠ 5 коммит(ов) в areas после сверки: c744579 Merge task 23e68524-34e9-4d40-a7da-0f43eb2a9670 … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 376 коммит(ов) в areas после сверки: 0f2f44b docs(kb): update after merge 30ed1bce-1824-46ed-9eba-285b59eed044 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-14 | ⚠ код изменён 2026-08-17, сверка 2026-08-14 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 1 коммит(ов) в areas после сверки: 5318356 CHAT-253: стадия kb_update merge-рана наследует движок development-рана |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-08 | ⚠ 13 коммит(ов) в areas после сверки: 056f5c7 fix(chat): publish queued messages in turn order … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-12 | ⚠ 56 коммит(ов) в areas после сверки: c744579 Merge task 23e68524-34e9-4d40-a7da-0f43eb2a9670 … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-17 | ⚠ 2 коммит(ов) в areas после сверки: 206a890 Merge task 0dfeebbd-8d46-4a4e-9e77-850f55c0c55c … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-12 | ⚠ 50 коммит(ов) в areas после сверки: c744579 Merge task 23e68524-34e9-4d40-a7da-0f43eb2a9670 … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-15 | ⚠ код изменён 2026-08-17, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-15 | ⚠ код изменён 2026-08-16, сверка 2026-08-15 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-15 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-16 | ⚠ 11 коммит(ов) в areas после сверки: 206a890 Merge task 0dfeebbd-8d46-4a4e-9e77-850f55c0c55c … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-17, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 234. Последние:

- [2026-08-17-mac-task-tabs-workflow-preview.md](log/2026-08-17-mac-task-tabs-workflow-preview.md) — task-tabs-workflow-preview
- [2026-08-17-mac-model-work-disclosure-git-transport.md](log/2026-08-17-mac-model-work-disclosure-git-transport.md) — model-work-disclosure-git-transport
- [2026-08-17-mac-merge-retry-machine.md](log/2026-08-17-mac-merge-retry-machine.md) — merge-retry-machine
- [2026-08-17-mac-chat-task-assignee.md](log/2026-08-17-mac-chat-task-assignee.md) — chat-task-assignee
- [2026-08-17-mac-cancelled-task-chat-visibility.md](log/2026-08-17-mac-cancelled-task-chat-visibility.md) — cancelled-task-chat-visibility
- [2026-08-17-mac-account-logout.md](log/2026-08-17-mac-account-logout.md) — account-logout
- [2026-08-16-mac-task-preparation-llm-settings.md](log/2026-08-16-mac-task-preparation-llm-settings.md) — task-preparation-llm-settings
- [2026-08-16-mac-playwright-reader-preview-binding.md](log/2026-08-16-mac-playwright-reader-preview-binding.md) — playwright-reader-preview-binding
- [2026-08-16-mac-merge-kb-update-engine.md](log/2026-08-16-mac-merge-kb-update-engine.md) — merge-kb-update-engine
- [2026-08-16-mac-ci-runner.md](log/2026-08-16-mac-ci-runner.md) — ci-runner

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 15 коммит(ов) в areas после сверки: 22b413d4 feat(releases): add managed production environments … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 35 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-18 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 11 коммит(ов) в areas после сверки: 8487fb08 Merge origin/main into CHAT-291 … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-18 | ⚠ 41 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-20 | ⚠ 37 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-23 | ⚠ 3 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-23 | ⚠ 2 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 85 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 27 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-22 | ⚠ 3 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-22 | ⚠ 12 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-19 | ⚠ 28 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 533 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-20 | ⚠ 41 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-23 | ⚠ 1 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-22 | ⚠ 3 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 12 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 4 коммит(ов) в areas после сверки: e047ac1b Merge task 53fa5ad2-ffbd-46f1-873a-dbd8c9f5eebd … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-23 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-23 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 11 коммит(ов) в areas после сверки: 4cc7ad17 feat(git-access): добавить credential для связки машины … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-22 | ⚠ 8 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-19 | ⚠ 29 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-23 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-23 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 24 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-20 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-19 | ⚠ 6 коммит(ов) в areas после сверки: 8487fb08 Merge origin/main into CHAT-291 … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-20 | ⚠ 18 коммит(ов) в areas после сверки: 17a93756 feat: add managed generated files TTL cleanup … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-23 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 315. Последние:

- [2026-08-23-alexeys-macbook-air-2-managed-production-staging.md](log/2026-08-23-alexeys-macbook-air-2-managed-production-staging.md) — managed-production-staging
- [2026-08-23-alexeys-macbook-air-2-environment-run-manifests-git-credentials.md](log/2026-08-23-alexeys-macbook-air-2-environment-run-manifests-git-credentials.md) — environment-run-manifests-git-credentials
- [2026-08-23-alexeys-macbook-air-2-codex-thread-lease-termux-node-gyp.md](log/2026-08-23-alexeys-macbook-air-2-codex-thread-lease-termux-node-gyp.md) — codex-thread-lease-termux-node-gyp
- [2026-08-23-alexeys-macbook-air-2-agent-0-11-2.md](log/2026-08-23-alexeys-macbook-air-2-agent-0-11-2.md) — agent-0-11-2
- [2026-08-23-2470-com-merge-machines-load-state.md](log/2026-08-23-2470-com-merge-machines-load-state.md) — merge-machines-load-state
- [2026-08-23-2470-com-generated-ttl-cleanup.md](log/2026-08-23-2470-com-generated-ttl-cleanup.md) — generated-ttl-cleanup
- [2026-08-22-alexeys-macbook-air-2-task-preparation-recovery.md](log/2026-08-22-alexeys-macbook-air-2-task-preparation-recovery.md) — task-preparation-recovery
- [2026-08-22-alexeys-macbook-air-2-task-preparation-project-model.md](log/2026-08-22-alexeys-macbook-air-2-task-preparation-project-model.md) — task-preparation-project-model
- [2026-08-22-alexeys-macbook-air-2-project-machine-directories.md](log/2026-08-22-alexeys-macbook-air-2-project-machine-directories.md) — project-machine-directories
- [2026-08-22-alexeys-macbook-air-2-managed-storage-integration.md](log/2026-08-22-alexeys-macbook-air-2-managed-storage-integration.md) — managed-storage-integration

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

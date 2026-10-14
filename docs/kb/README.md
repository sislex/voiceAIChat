<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ⚠ код изменён 2026-10-15, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-09 | ⚠ 10 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ⚠ 54 коммит(ов) в areas после сверки: 2cae8d08 SISL-720: remove unused vendor archives and share pin cleanup checks … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 27 коммит(ов) в areas после сверки: 369c0dd5 stand-https-v1 B02 … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-08 | ⚠ 6 коммит(ов) в areas после сверки: 94915425 stand-https-v1 C01 … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-14 | ⚠ 4 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 126 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 52 коммит(ов) в areas после сверки: 94915425 stand-https-v1 C01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 301 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 444 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 70 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 1 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 85 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 46 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 36 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 100 коммит(ов) в areas после сверки: 0ab44721 docs(kb): update after merge 488770d9-3720-4ec5-953f-9f2c403c7739 … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 114 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-14, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 7 коммит(ов) в areas после сверки: 263b9c55 fix(release-gate): verified base from where the production release branch forked … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-14 | ⚠ 8 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 47 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-05 | ⚠ 92 коммит(ов) в areas после сверки: e87c0ab1 fix(core): disable caching for health responses … |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-10 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-15, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 3 коммит(ов) в areas после сверки: 593220a9 docs(kb): glossary of roles, services, stands, delivery and technical terms … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-14, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-14 | ✓ |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-08 | ⚠ 7 коммит(ов) в areas после сверки: 3a73a77a feat(chat): thread context usage and conversation thread reset (chat-history-v2 B01) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-08 | ⚠ код изменён 2026-10-14, сверка 2026-10-08 (по датам: правки того же дня не видны — поставь checked) |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-15 | ✓ |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-08 | ⚠ 9 коммит(ов) в areas после сверки: 94915425 stand-https-v1 C01 … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-15, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-14 | ⚠ 4 коммит(ов) в areas после сверки: 84f9fa97 chore(kanban): pin Kanban 0.2.19 … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-15, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-15, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1166. Последние:

- [2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-make-browser-link.md](log/2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-make-browser-link.md) — make-browser-link
- [2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-health-no-store.md](log/2026-10-15-alexeys-macbook-air-tailae39a6-ts-net-health-no-store.md) — health-no-store
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-vendor-archive-publication.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-vendor-archive-publication.md) — vendor-archive-publication
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-ui-delivery-step-diagnostics.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-ui-delivery-step-diagnostics.md) — ui-delivery-step-diagnostics
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-system-gate-process-diagnostics.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-system-gate-process-diagnostics.md) — system-gate-process-diagnostics
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-system-gate-owner-cache.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-system-gate-owner-cache.md) — system-gate-owner-cache
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-worktree-behind.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-worktree-behind.md) — stand-worktree-behind
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-proxy-https.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-proxy-https.md) — stand-proxy-https
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-error-codes.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-stand-error-codes.md) — stand-error-codes
- [2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-release-failure-summary.md](log/2026-10-14-alexeys-macbook-air-tailae39a6-ts-net-release-failure-summary.md) — release-failure-summary

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

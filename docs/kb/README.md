<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ✓ |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-07 | ⚠ код изменён 2026-10-17, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-18 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-16 | ⚠ 10 коммит(ов) в areas после сверки: c8a9b96c chore(vendor): move pinned owner archives out of git into the vendor release … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 30 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-16 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-18 | ⚠ 1 коммит(ов) в areas после сверки: 74719b63 chore: pin Kanban 0.2.32 (stand users password, dev swap fixes) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 149 коммит(ов) в areas после сверки: 74719b63 chore: pin Kanban 0.2.32 (stand users password, dev swap fixes) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 13 коммит(ов) в areas после сверки: a189b2a3 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 57 коммит(ов) в areas после сверки: c0d0b635 operator-assistant-model-v1 B01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-17 | ⚠ 1 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 447 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 72 коммит(ов) в areas после сверки: c0d0b635 operator-assistant-model-v1 B01 … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 3 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 92 коммит(ов) в areas после сверки: c0d0b635 operator-assistant-model-v1 B01 … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-15 | ⚠ 10 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 42 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 135 коммит(ов) в areas после сверки: 74719b63 chore: pin Kanban 0.2.32 (stand users password, dev swap fixes) … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 118 коммит(ов) в areas после сверки: b33170a6 chore: pin Identity 1.5.0 (API tokens for external agents) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 9 коммит(ов) в areas после сверки: c8a9b96c chore(vendor): move pinned owner archives out of git into the vendor release … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-14 | ⚠ 31 коммит(ов) в areas после сверки: 74719b63 chore: pin Kanban 0.2.32 (stand users password, dev swap fixes) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 52 коммит(ов) в areas после сверки: c0d0b635 operator-assistant-model-v1 B01 … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-17, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-10 | ⚠ 2 коммит(ов) в areas после сверки: c8a9b96c chore(vendor): move pinned owner archives out of git into the vendor release … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-17, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 4 коммит(ов) в areas после сверки: c8a9b96c chore(vendor): move pinned owner archives out of git into the vendor release … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-17, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-14 | ⚠ код изменён 2026-10-17, сверка 2026-10-14 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-17 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-17 | ⚠ код изменён 2026-10-18, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-15 | ⚠ 10 коммит(ов) в areas после сверки: 4f4512c5 fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-17 | ⚠ 4 коммит(ов) в areas после сверки: 2f3f592d Merge pull request #727 from sislex/feat/stand-users-password … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-18, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-18 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-18, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-17, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1195. Последние:

- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-publish-opt-in.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-publish-opt-in.md) — vendor-publish-opt-in
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-archives-out-of-git.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-archives-out-of-git.md) — vendor-archives-out-of-git
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-system-gate-fetch-retry.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-system-gate-fetch-retry.md) — system-gate-fetch-retry
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-stand-users-password.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-stand-users-password.md) — stand-users-password
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-stand-runner-profile-dev-core.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-stand-runner-profile-dev-core.md) — stand-runner-profile-dev-core
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-32.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-32.md) — pin-kanban-0-2-32
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-31.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-31.md) — pin-kanban-0-2-31
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-30.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-30.md) — pin-kanban-0-2-30
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-29.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-pin-kanban-0-2-29.md) — pin-kanban-0-2-29
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-freeze-desktop.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-freeze-desktop.md) — freeze-desktop

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

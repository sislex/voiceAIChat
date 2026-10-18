<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-19 | ⚠ 1 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-18 | ⚠ 346 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-16 | ⚠ 171 коммит(ов) в areas после сверки: f628a5fe3 feat(deployment): applications per build in Core (deployment-profiles-v1 C01) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 637 коммит(ов) в areas после сверки: ea038d11b fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-19 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-19 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 1482 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e20 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 521 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-17 | ⚠ 1040 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 985 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 391 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 489 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 786 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-15 | ⚠ 905 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 922 коммит(ов) в areas после сверки: ea038d11b fix(kanban-assistant): skip task-launch rule when autopilot is on … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-06 | ⚠ 2154 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1085 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 69 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-14 | ⚠ 1418 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 668 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-19, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-10 | ⚠ 69 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 124 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-14 | ⚠ код изменён 2026-10-19, сверка 2026-10-14 (по датам: правки того же дня не видны — поставь checked) |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-17 | ⚠ код изменён 2026-10-19, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-15 | ⚠ 1210 коммит(ов) в areas после сверки: f65a3fd43 feat(shared-services): Core delegation on ticket redeem (deployment-profiles-v1 B02) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-19 | ✓ |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-18 | ⚠ 351 коммит(ов) в areas после сверки: 0a851f7b8 Merge pull request #740 from sislex/fix/shared-peers-any-range … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-19, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1204. Последние:

- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-peers-any-range.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-peers-any-range.md) — shared-peers-any-range
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-optional-peers.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-shared-optional-peers.md) — shared-optional-peers
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-39.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-39.md) — pin-shared-0-1-39
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-38.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-38.md) — pin-shared-0-1-38
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-37.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-37.md) — pin-shared-0-1-37
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-36.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-pin-shared-0-1-36.md) — pin-shared-0-1-36
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-deployment-profiles-c01.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-deployment-profiles-c01.md) — deployment-profiles-c01
- [2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-b02-ticket-delegation.md](log/2026-10-19-alexeys-macbook-air-tailae39a6-ts-net-b02-ticket-delegation.md) — b02-ticket-delegation
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-publish-opt-in.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-publish-opt-in.md) — vendor-publish-opt-in
- [2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-archives-out-of-git.md](log/2026-10-18-alexeys-macbook-air-tailae39a6-ts-net-vendor-archives-out-of-git.md) — vendor-archives-out-of-git

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

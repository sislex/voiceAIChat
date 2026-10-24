<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-10-17 | ⚠ код изменён 2026-10-24, сверка 2026-10-17 (по датам: правки того же дня не видны — поставь checked) |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-10-20 | ⚠ 3 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-20 | ⚠ 6 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 645 коммит(ов) в areas после сверки: 3160172e1 fix: expire widget confirmations with an explicit lifecycle event … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-24 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-24 | ⚠ 1 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-10-24 | ⚠ 8 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 226 коммит(ов) в areas после сверки: efb581e20 SISL-736: persist project merge targets and use remote task bases … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 521 коммит(ов) в areas после сверки: e6e633326 operator-assistant-model-v1 B01 … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-10-24 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 999 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 402 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-10-15 | ⚠ 504 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 799 коммит(ов) в areas после сверки: 556a06ce0 Merge dev into SK-68 (task 64cb9254-6e64-4a7d-b8fc-3e14e55f35f0) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-10-24 | ⚠ 2 коммит(ов) в areas после сверки: 3b1df6c2a Merge dev into main: Kanban 0.2.38, Core UI 1.5.29 … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 3160172e1 fix: expire widget confirmations with an explicit lifecycle event |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-10-20 | ⚠ 31 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 1096 коммит(ов) в areas после сверки: 985b9e55d feat(mcp): add scoped historical journal verification … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ⚠ код изменён 2026-10-18, сверка 2026-10-01 (по датам: правки того же дня не видны — поставь checked) |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 69 коммит(ов) в areas после сверки: ee9f35a52 chore(vendor): move pinned owner archives out of git into the vendor release … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-10-20 | ⚠ 14 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 669 коммит(ов) в areas после сверки: 6357410e5 Expose Analytics configuration and polish public chat defaults … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-10-15 | ⚠ код изменён 2026-10-24, сверка 2026-10-15 (по датам: правки того же дня не видны — поставь checked) |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 592879f34 Document isolated public chat release and sislexa naming |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-10-05 | ⚠ 126 коммит(ов) в areas после сверки: 592879f34 Document isolated public chat release and sislexa naming … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-10-24 | ⚠ 3 коммит(ов) в areas после сверки: 556a06ce0 Merge dev into SK-68 (task 64cb9254-6e64-4a7d-b8fc-3e14e55f35f0) … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-20 | ⚠ 5 коммит(ов) в areas после сверки: 556a06ce0 Merge dev into SK-68 (task 64cb9254-6e64-4a7d-b8fc-3e14e55f35f0) … |
| [modules.md](modules.md) | Module ownership map | 2026-10-07 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 3160172e1 fix: expire widget confirmations with an explicit lifecycle event |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-10-24 | ✓ |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-22 | ⚠ 5 коммит(ов) в areas после сверки: 556a06ce0 Merge dev into SK-68 (task 64cb9254-6e64-4a7d-b8fc-3e14e55f35f0) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-20 | ⚠ 1 коммит(ов) в areas после сверки: 3160172e1 fix: expire widget confirmations with an explicit lifecycle event |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-10-07 | ⚠ код изменён 2026-10-20, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-10-24 | ⚠ 4 коммит(ов) в areas после сверки: 0867e94e1 chore: pin Kanban 0.2.40 and Core UI 1.5.30 (SK-76 release notifications for members, auto-dismiss) … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-10-07 | ⚠ код изменён 2026-10-24, сверка 2026-10-07 (по датам: правки того же дня не видны — поставь checked) |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1266. Последние:

- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sk68-confirmation-contract-verification.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sk68-confirmation-contract-verification.md) — sk68-confirmation-contract-verification
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl776-prepared-origin.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl776-prepared-origin.md) — sisl776-prepared-origin
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl763-origin-history-gaps.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl763-origin-history-gaps.md) — sisl763-origin-history-gaps
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-775-owner-history.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-775-owner-history.md) — sisl-775-owner-history
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-771-owner-gate-kb.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-sisl-771-owner-gate-kb.md) — sisl-771-owner-gate-kb
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence.md) — scoped-historical-evidence
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence-kb.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-scoped-historical-evidence-kb.md) — scoped-historical-evidence-kb
- [2026-10-24-pc-radvilovich-tailae39a6-ts-net-confirmation-expiration.md](log/2026-10-24-pc-radvilovich-tailae39a6-ts-net-confirmation-expiration.md) — confirmation-expiration
- [2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-sisl-763-owner-gate-retry.md](log/2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-sisl-763-owner-gate-retry.md) — sisl-763-owner-gate-retry
- [2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-sisl-763-identity-acceptance-audit.md](log/2026-10-24-alexeys-macbook-air-tailae39a6-ts-net-sisl-763-identity-acceptance-audit.md) — sisl-763-identity-acceptance-audit

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

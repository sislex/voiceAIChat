<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-20 | ⚠ 18 коммит(ов) в areas после сверки: e35499be feat(shared): release composition contract for @voicechat/shared 0.1.13 … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-22 | ⚠ 28 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-10-03 | ✓ |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-10-04 | ✓ |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-09-29 | ⚠ 11 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-10-03 | ⚠ 4 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-10-04 | ⚠ 1 коммит(ов) в areas после сверки: 674ed0b1 fix(stands): accept Compose host=ip extra_hosts rendering for module stands |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-28 | ⚠ 45 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-09-17 | ⚠ 12 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 37 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 265 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 415 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 47 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-09-30 | ⚠ 2 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-17 | ⚠ 50 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-29 | ⚠ 11 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-22 | ⚠ 23 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1753 коммит(ов) в areas после сверки: 674ed0b1 fix(stands): accept Compose host=ip extra_hosts rendering for module stands … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 86 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-10-01 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-09-30 | ⚠ 3 коммит(ов) в areas после сверки: 539581e9 fix(gate): lead full-plan reasons with the changed Core code … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-23 | ⚠ 67 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-16 | ⚠ 39 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-17 | ⚠ 59 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 423 коммит(ов) в areas после сверки: 2ec9724a feat(server): project integration tokens and integration ingress (B05) … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-09-29 | ⚠ 3 коммит(ов) в areas после сверки: ab7db3f2 docs: quick task gate, background full gate of main (plan delivery-fast-gate) … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-29 | ⚠ 3 коммит(ов) в areas после сверки: 70d7238c refactor: remove embedded Kanban from Core … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-10-04 | ⚠ 4 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 275 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-29 | ⚠ 10 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-30 | ⚠ 6 коммит(ов) в areas после сверки: e1c67868 feat(machines): environment VPN grants and machine VPN addresses (environments-v4 C23) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-10-04 | ⚠ 2 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-10-04 | ⚠ 1 коммит(ов) в areas после сверки: f11e2c9a feat(shared): environments-v4 contracts |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 261 коммит(ов) в areas после сверки: 6503d727 chore: pin Kanban 0.1.8 (snapshot failure detail) … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-09-20 | ⚠ 6 коммит(ов) в areas после сверки: e86fbb8c refactor(ui): consume independently released Core UI artifacts … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-30 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 213 коммит(ов) в areas после сверки: 6503d727 chore: pin Kanban 0.1.8 (snapshot failure detail) … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-29 | ⚠ 15 коммит(ов) в areas после сверки: aa936e48 feat(environments): VPN or tunnel transport for environment links (environments-v4 C24) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-22, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-09-29 | ✓ |

## Инструкции по пакетам

- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1027. Последние:

- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-tunnel-relay-backpressure.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-tunnel-relay-backpressure.md) — tunnel-relay-backpressure
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-tunnel-frame-order.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-tunnel-frame-order.md) — tunnel-frame-order
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-stand-extra-hosts-equals.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-stand-extra-hosts-equals.md) — stand-extra-hosts-equals
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-snapshot-fk-closure.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-snapshot-fk-closure.md) — snapshot-fk-closure
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-plan-archive-split.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-plan-archive-split.md) — plan-archive-split
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-environments-v4-shared.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-environments-v4-shared.md) — environments-v4-shared
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-delivery-fast-gate.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-delivery-fast-gate.md) — delivery-fast-gate
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c26-files-maintenance.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c26-files-maintenance.md) — c26-files-maintenance
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c25-stand-stage4.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c25-stand-stage4.md) — c25-stand-stage4
- [2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c24-link-transport.md](log/2026-10-04-alexeys-macbook-air-tailae39a6-ts-net-c24-link-transport.md) — c24-link-transport

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

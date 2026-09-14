<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-13 | ⚠ 3 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-10 | ⚠ 22 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 44 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-11 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-13 | ✓ |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-12 | ⚠ 4 коммит(ов) в areas после сверки: 70e9afe3 feat(admin): improve user and session access management (CHAT-453) … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-13 | ⚠ 1 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 2 коммит(ов) в areas после сверки: 62166a80 Merge main into CHAT-465 (task d06a4009-0ece-45c2-9749-757d0083960a) … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 167 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 327 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 4 коммит(ов) в areas после сверки: 997ae931 feat(ci): require browser evidence for model work … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-13 | ⚠ 2 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 120 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-10 | ⚠ 35 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1447 коммит(ов) в areas после сверки: 0b6c1d15 docs(kb): update after merge d06a4009-0ece-45c2-9749-757d0083960a … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 2 коммит(ов) в areas после сверки: 62166a80 Merge main into CHAT-465 (task d06a4009-0ece-45c2-9749-757d0083960a) … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-12 | ⚠ 24 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-11 | ⚠ 36 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-13 | ⚠ 1 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 335 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 23 коммит(ов) в areas после сверки: 997ae931 feat(ci): require browser evidence for model work … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-13 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-13 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 236 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-13 | ⚠ 9 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-10 | ⚠ 24 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-13 | ⚠ 9 коммит(ов) в areas после сверки: 62166a80 Merge main into CHAT-465 (task d06a4009-0ece-45c2-9749-757d0083960a) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-11 | ⚠ 23 коммит(ов) в areas после сверки: 99e14157 feat(machines): add guarded Tailscale VPN management … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 201 коммит(ов) в areas после сверки: 181c142e feat(qa): improve stage panels and snapshot retries … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 6 коммит(ов) в areas после сверки: 88eb665f feat(releases): независимые проверки и выпуски приложений … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-13 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 153 коммит(ов) в areas после сверки: 181c142e feat(qa): improve stage panels and snapshot retries … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-13 | ⚠ 7 коммит(ов) в areas после сверки: 62166a80 Merge main into CHAT-465 (task d06a4009-0ece-45c2-9749-757d0083960a) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-13, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-08-13 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/image-studio](../../apps/image-studio/AGENTS.md)
- [apps/llm-runner](../../apps/llm-runner/AGENTS.md)
- [apps/make](../../apps/make/AGENTS.md)
- [apps/playwright-reader](../../apps/playwright-reader/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [apps/web-reader](../../apps/web-reader/AGENTS.md)
- [packages/browser-contracts](../../packages/browser-contracts/AGENTS.md)
- [packages/image-studio-app](../../packages/image-studio-app/AGENTS.md)
- [packages/make-app](../../packages/make-app/AGENTS.md)
- [packages/make-contracts](../../packages/make-contracts/AGENTS.md)
- [packages/playwright-reader-app](../../packages/playwright-reader-app/AGENTS.md)
- [packages/playwright-reader-contracts](../../packages/playwright-reader-contracts/AGENTS.md)
- [packages/projects-app](../../packages/projects-app/AGENTS.md)
- [packages/sessions-app](../../packages/sessions-app/AGENTS.md)
- [packages/sessions-core](../../packages/sessions-core/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)
- [packages/ui-foundation](../../packages/ui-foundation/AGENTS.md)
- [packages/web-reader-app](../../packages/web-reader-app/AGENTS.md)
- [packages/web-reader-contracts](../../packages/web-reader-contracts/AGENTS.md)

## Журнал сессий

Всего записей: 822. Последние:

- [2026-09-13-germany-4-8-60-machine-vpn-and-electron-deps.md](log/2026-09-13-germany-4-8-60-machine-vpn-and-electron-deps.md) — machine-vpn-and-electron-deps
- [2026-09-13-germany-4-8-60-kanban-mobile-kb.md](log/2026-09-13-germany-4-8-60-kanban-mobile-kb.md) — kanban-mobile-kb
- [2026-09-13-germany-4-8-60-integration-readiness-classification.md](log/2026-09-13-germany-4-8-60-integration-readiness-classification.md) — integration-readiness-classification
- [2026-09-13-germany-4-8-60-feature-preview-launch-readiness.md](log/2026-09-13-germany-4-8-60-feature-preview-launch-readiness.md) — feature-preview-launch-readiness
- [2026-09-13-germany-4-8-60-chat451-machine-console-kb.md](log/2026-09-13-germany-4-8-60-chat451-machine-console-kb.md) — chat451-machine-console-kb
- [2026-09-13-alexeys-macbook-air-tailae39a6-ts-net-codex-cumulative-usage.md](log/2026-09-13-alexeys-macbook-air-tailae39a6-ts-net-codex-cumulative-usage.md) — codex-cumulative-usage
- [2026-09-13-alexeys-macbook-air-2-qa-panels-selective-retry.md](log/2026-09-13-alexeys-macbook-air-2-qa-panels-selective-retry.md) — qa-panels-selective-retry
- [2026-09-13-alexeys-macbook-air-2-qa-panels-qa-workflow-kb.md](log/2026-09-13-alexeys-macbook-air-2-qa-panels-qa-workflow-kb.md) — qa-panels-qa-workflow-kb
- [2026-09-13-alexeys-macbook-air-2-project-settings-kb.md](log/2026-09-13-alexeys-macbook-air-2-project-settings-kb.md) — project-settings-kb
- [2026-09-13-alexeys-macbook-air-2-make-flow-strict-brief.md](log/2026-09-13-alexeys-macbook-air-2-make-flow-strict-brief.md) — make-flow-strict-brief

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

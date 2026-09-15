<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-13 | ⚠ 4 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-10 | ⚠ 41 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 45 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-11 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-13 | ⚠ 19 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-12 | ⚠ 4 коммит(ов) в areas после сверки: 70e9afe3 feat(admin): improve user and session access management (CHAT-453) … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-13 | ⚠ 4 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-13 | ⚠ 4 коммит(ов) в areas после сверки: 2a2e6825 fix(db): run the Codex usage backfill one reply at a time … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 170 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 330 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-09-12 | ⚠ 5 коммит(ов) в areas после сверки: e8c00896 fix(llm): price Codex turns as the difference of thread totals, not the totals … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-13 | ⚠ 4 коммит(ов) в areas после сверки: 2a2e6825 fix(db): run the Codex usage backfill one reply at a time … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 123 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-15 | ⚠ 1 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1471 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-13 | ⚠ 5 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-12 | ⚠ 27 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-11 | ⚠ 40 коммит(ов) в areas после сверки: 4632bced Merge main into CHAT-466 (task 2c900bc5-86d3-4216-857c-529cc8951e5f) … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-15 | ⚠ 1 коммит(ов) в areas после сверки: b1f9f1d4 Merge remote-tracking branch 'origin/main' into codex/web-reader-20-cycles |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 353 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 24 коммит(ов) в areas после сверки: e8c00896 fix(llm): price Codex turns as the difference of thread totals, not the totals … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-14 | ⚠ 1 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-14 | ⚠ 1 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 237 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-15 | ⚠ 16 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-15 | ⚠ 12 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-15 | ⚠ 1 коммит(ов) в areas после сверки: fc4b9234 perf(account): load profile sections progressively |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-11 | ⚠ 41 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 201 коммит(ов) в areas после сверки: 181c142e feat(qa): improve stage panels and snapshot retries … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 6 коммит(ов) в areas после сверки: 88eb665f feat(releases): независимые проверки и выпуски приложений … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-13 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 153 коммит(ов) в areas после сверки: 181c142e feat(qa): improve stage panels and snapshot retries … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-15 | ⚠ 17 коммит(ов) в areas после сверки: d25e5c70 feat(playwright-reader): answer with a verdict, not a percentage (cycle 16) … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-15, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 847. Последние:

- [2026-09-15-germany-4-8-60-universal-search.md](log/2026-09-15-germany-4-8-60-universal-search.md) — universal-search
- [2026-09-15-germany-4-8-60-universal-search-kb.md](log/2026-09-15-germany-4-8-60-universal-search-kb.md) — universal-search-kb
- [2026-09-15-germany-4-8-60-chat468-route-read-cache.md](log/2026-09-15-germany-4-8-60-chat468-route-read-cache.md) — chat468-route-read-cache
- [2026-09-15-germany-4-8-60-chat468-route-cache-kb.md](log/2026-09-15-germany-4-8-60-chat468-route-cache-kb.md) — chat468-route-cache-kb
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-19.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-19.md) — web-reader-user-like-cycle-19
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-18.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-18.md) — web-reader-user-like-cycle-18
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-17.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-17.md) — web-reader-user-like-cycle-17
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-16.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-16.md) — web-reader-user-like-cycle-16
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-15.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-15.md) — web-reader-user-like-cycle-15
- [2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-14.md](log/2026-09-15-alexeys-macbook-air-tailae39a6-ts-net-web-reader-user-like-cycle-14.md) — web-reader-user-like-cycle-14

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

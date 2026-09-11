<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-09-01 | ⚠ 96 коммит(ов) в areas после сверки: ec181445 Merge main into CHAT-444 (task 07d7f465-05cb-4f97-b4bf-3bfc36619e26) … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-09-10 | ⚠ 8 коммит(ов) в areas после сверки: 6e243af8 feat(web-reader): add searchable assistant action history (#145) … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-09-07 | ⚠ 30 коммит(ов) в areas после сверки: 93427cdf feat(readers): независимые приложения и релизы Web Reader и Playwright … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-09-11 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-09-11 | ⚠ 1 коммит(ов) в areas после сверки: 47c6484b fix(db): reconcile PostgreSQL columns on startup |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-09-10 | ⚠ 6 коммит(ов) в areas после сверки: ac340e14 feat(web-reader): expose native accessibility evidence … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-09-09 | ⚠ 56 коммит(ов) в areas после сверки: 69b1f61a feat(kanban): keep mobile filters in reach … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-09-10 | ⚠ 6 коммит(ов) в areas после сверки: c1910313 feat(kanban): add due date windows … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-09-02 | ⚠ 148 коммит(ов) в areas после сверки: ec181445 Merge main into CHAT-444 (task 07d7f465-05cb-4f97-b4bf-3bfc36619e26) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 311 коммит(ов) в areas после сверки: ec181445 Merge main into CHAT-444 (task 07d7f465-05cb-4f97-b4bf-3bfc36619e26) … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 199 коммит(ов) в areas после сверки: 93427cdf feat(readers): независимые приложения и релизы Web Reader и Playwright … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-09-04 | ⚠ 82 коммит(ов) в areas после сверки: c1910313 feat(kanban): add due date windows … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-09-04 | ⚠ 105 коммит(ов) в areas после сверки: c1910313 feat(kanban): add due date windows … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-09-10 | ⚠ 14 коммит(ов) в areas после сверки: ec181445 Merge main into CHAT-444 (task 07d7f465-05cb-4f97-b4bf-3bfc36619e26) … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 1388 коммит(ов) в areas после сверки: 69b1f61a feat(kanban): keep mobile filters in reach … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-09-11 | ⚠ 29 коммит(ов) в areas после сверки: 69b1f61a feat(kanban): keep mobile filters in reach … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-09-10 | ⚠ 31 коммит(ов) в areas после сверки: 69b1f61a feat(kanban): keep mobile filters in reach … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-09-11 | ⚠ 12 коммит(ов) в areas после сверки: 0ebaed5f feat(kanban): show task update freshness … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-09-11 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 320 коммит(ов) в areas после сверки: ac3e00c1 fix(kanban): advance autonomous QA delivery and add task manual QA pause … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-31 | ⚠ 22 коммит(ов) в areas после сверки: ac3e00c1 fix(kanban): advance autonomous QA delivery and add task manual QA pause … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-09-11 | ⚠ 2 коммит(ов) в areas после сверки: 2607fd04 feat: route task tabs and tighten brief validation … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-09-10 | ⚠ 9 коммит(ов) в areas после сверки: c1910313 feat(kanban): add due date windows … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 224 коммит(ов) в areas после сверки: 2607fd04 feat: route task tabs and tighten brief validation … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-09-11 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-09-10 | ⚠ 6 коммит(ов) в areas после сверки: ac3e00c1 fix(kanban): advance autonomous QA delivery and add task manual QA pause … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-09-10 | ⚠ 6 коммит(ов) в areas после сверки: ec181445 Merge main into CHAT-444 (task 07d7f465-05cb-4f97-b4bf-3bfc36619e26) … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-09-11 | ⚠ 1 коммит(ов) в areas после сверки: c1910313 feat(kanban): add due date windows |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 198 коммит(ов) в areas после сверки: 93427cdf feat(readers): независимые приложения и релизы Web Reader и Playwright … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ⚠ 6 коммит(ов) в areas после сверки: 88eb665f feat(releases): независимые проверки и выпуски приложений … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-09-11 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 150 коммит(ов) в areas после сверки: 93427cdf feat(readers): независимые приложения и релизы Web Reader и Playwright … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-09-11 | ⚠ 20 коммит(ов) в areas после сверки: 69b1f61a feat(kanban): keep mobile filters in reach … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-09-11, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 782. Последние:

- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-10.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-10.md) — web-reader-ten-cycle-10
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-09.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-09.md) — web-reader-ten-cycle-09
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-08.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-08.md) — web-reader-ten-cycle-08
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-07.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-07.md) — web-reader-ten-cycle-07
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-06.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-06.md) — web-reader-ten-cycle-06
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-05.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-05.md) — web-reader-ten-cycle-05
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-04.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-04.md) — web-reader-ten-cycle-04
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-03.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-03.md) — web-reader-ten-cycle-03
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-02.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-02.md) — web-reader-ten-cycle-02
- [2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-01.md](log/2026-09-11-alexeys-macbook-air-2-web-reader-ten-cycle-01.md) — web-reader-ten-cycle-01

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

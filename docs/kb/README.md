<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 107 коммит(ов) в areas после сверки: 6713ad47 Merge task b5ad5ef8-7165-4127-921a-08e965d6c12a … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 118 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-27 | ⚠ 1 коммит(ов) в areas после сверки: a8c141af fix(desktop): зелёный typecheck — фикстура Settings через DEFAULT_SETTINGS, типы ?worker (roadmap-2 п.6) |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 12 коммит(ов) в areas после сверки: b088d0c5 test(make): E2E в headless Chromium — превью React, компоненты, Monaco, публикация (п.37) … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-28 | ⚠ 8 коммит(ов) в areas после сверки: 0f4a4dac feat(machines): токены агентов — срок, отзыв (владелец/админ), привязка к IP, журнал подключений в «Безопасности» (roadmap п.11) … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-28 | ⚠ 11 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-25 | ⚠ 122 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-23 | ⚠ 40 коммит(ов) в areas после сверки: 0f4a4dac feat(machines): токены агентов — срок, отзыв (владелец/админ), привязка к IP, журнал подключений в «Безопасности» (roadmap п.11) … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-28 | ⚠ 3 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 77 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-24 | ⚠ 72 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-24 | ⚠ 74 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-25 | ⚠ 67 коммит(ов) в areas после сверки: 6713ad47 Merge task b5ad5ef8-7165-4127-921a-08e965d6c12a … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 750 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-20 | ⚠ 175 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-28 | ⚠ 20 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-28 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 91 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 6 коммит(ов) в areas после сверки: 4ad84a43 feat(machines): каталог ChatAI по умолчанию при подключении машины и привязка чатов к нему … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-27 | ⚠ 18 коммит(ов) в areas после сверки: 0f4a4dac feat(machines): токены агентов — срок, отзыв (владелец/админ), привязка к IP, журнал подключений в «Безопасности» (roadmap п.11) … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-28 | ⚠ 3 коммит(ов) в areas после сверки: 6713ad47 Merge task b5ad5ef8-7165-4127-921a-08e965d6c12a … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 73 коммит(ов) в areas после сверки: 6713ad47 Merge task b5ad5ef8-7165-4127-921a-08e965d6c12a … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-28 | ✓ |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-27 | ⚠ 16 коммит(ов) в areas после сверки: 0f4a4dac feat(machines): токены агентов — срок, отзыв (владелец/админ), привязка к IP, журнал подключений в «Безопасности» (roadmap п.11) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-27 | ⚠ 17 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-27 | ⚠ 13 коммит(ов) в areas после сверки: 0f4a4dac feat(machines): токены агентов — срок, отзыв (владелец/админ), привязка к IP, журнал подключений в «Безопасности» (roadmap п.11) … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 69 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-27 | ⚠ 1 коммит(ов) в areas после сверки: 43f3b3c7 chore(compose): проброс VC_SMTP_URL/VC_MAIL_FROM/VC_PUBLIC_URL в server для регистрации по email |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-26 | ⚠ 22 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-27 | ⚠ 24 коммит(ов) в areas после сверки: 59646f64 Merge task fd07e97a-b09b-464e-a703-7625bc29afbf … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-28, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 391. Последние:

- [2026-08-28-macbook-air-user-task-modal-brief-validation.md](log/2026-08-28-macbook-air-user-task-modal-brief-validation.md) — task-modal-brief-validation
- [2026-08-28-macbook-air-user-simplify-chat-header-kb-usage.md](log/2026-08-28-macbook-air-user-simplify-chat-header-kb-usage.md) — simplify-chat-header-kb-usage
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-9.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-9.md) — machines-roadmap-9
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-8.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-8.md) — machines-roadmap-8
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-7.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-7.md) — machines-roadmap-7
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-5.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-5.md) — machines-roadmap-5
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-4.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-4.md) — machines-roadmap-4
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-3.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-3.md) — machines-roadmap-3
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-2.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-2.md) — machines-roadmap-2
- [2026-08-28-alexeys-macbook-air-2-machines-roadmap-17.md](log/2026-08-28-alexeys-macbook-air-2-machines-roadmap-17.md) — machines-roadmap-17

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

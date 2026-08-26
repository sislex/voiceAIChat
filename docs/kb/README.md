<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-08-19 | ⚠ 53 коммит(ов) в areas после сверки: c97bf9ec fix(ui): скрыть баннер модели STT при выключенном голосе; лоадер вместо мигающей формы логина … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-08-20 | ⚠ 67 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-08-24 | ⚠ 2 коммит(ов) в areas после сверки: 92e42b00 feat(playwright-reader): связка панели с browser-runner (оркестрация + Chromium) … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-08-01 | ⚠ 11 коммит(ов) в areas после сверки: 8487fb08 Merge origin/main into CHAT-291 … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-08-18 | ⚠ 57 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-08-25 | ⚠ 4 коммит(ов) в areas после сверки: 2e0cb213 feat(console): инструмент «Консоль с ассистентом» (разделяемый PTY) … |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-08-25 | ⚠ 21 коммит(ов) в areas после сверки: 5a60255e feat(chat): блок токенов — триггер сведений об ответе, иконка ⓘ удалена … |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-08-23 | ⚠ 20 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-08-16 | ⚠ 112 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-08-18 | ⚠ 47 коммит(ов) в areas после сверки: 2e0cb213 feat(console): инструмент «Консоль с ассистентом» (разделяемый PTY) … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-08-24 | ⚠ 26 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-08-24 | ⚠ 18 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-08-25 | ⚠ 12 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-08-02 | ⚠ 620 коммит(ов) в areas после сверки: 5a60255e feat(chat): блок токенов — триггер сведений об ответе, иконка ⓘ удалена … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-08-20 | ⚠ 88 коммит(ов) в areas после сверки: 5a60255e feat(chat): блок токенов — триггер сведений об ответе, иконка ⓘ удалена … |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-08-25 | ⚠ 12 коммит(ов) в areas после сверки: 5a60255e feat(chat): блок токенов — триггер сведений об ответе, иконка ⓘ удалена … |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-08-25 | ⚠ 13 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-08-22 | ⚠ 41 коммит(ов) в areas после сверки: 7056ce02 feat(settings): инструкции чата с чекбоксами — модель получает только включённые подсказки … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-08-16 | ⚠ 5 коммит(ов) в areas после сверки: 2198e7a9 fix: auto-resolve merge conflicts with model step … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-08-26 | ✓ |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-08-25 | ⚠ 18 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-08-19 | ⚠ 38 коммит(ов) в areas после сверки: c97bf9ec fix(ui): скрыть баннер модели STT при выключенном голосе; лоадер вместо мигающей формы логина … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-08-25 | ⚠ 11 коммит(ов) в areas после сверки: 5a60255e feat(chat): блок токенов — триггер сведений об ответе, иконка ⓘ удалена … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-08-25 | ⚠ 9 коммит(ов) в areas после сверки: 2e0cb213 feat(console): инструмент «Консоль с ассистентом» (разделяемый PTY) … |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-08-25 | ⚠ 11 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-08-26 | ⚠ 2 коммит(ов) в areas после сверки: 43994ac8 feat(turns): вырезать блоки выключенных инструкций из ответа модели … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-08-20 | ⚠ 47 коммит(ов) в areas после сверки: 2e0cb213 feat(console): инструмент «Консоль с ассистентом» (разделяемый PTY) … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-08-20 | ⚠ 2 коммит(ов) в areas после сверки: e91c96d4 web reader … |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-08-25 | ✓ |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-08-20 | ⚠ 41 коммит(ов) в areas после сверки: 2e0cb213 feat(console): инструмент «Консоль с ассистентом» (разделяемый PTY) … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-08-26 | ✓ |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться ChatAI | 2026-08-01 | ⚠ код изменён 2026-08-26, сверка 2026-08-01 (по датам: правки того же дня не видны — поставь checked) |
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

Всего записей: 364. Последние:

- [2026-08-26-alexeys-macbook-air-2-reader-layout-and-diagnostics.md](log/2026-08-26-alexeys-macbook-air-2-reader-layout-and-diagnostics.md) — 2026-08-26-alexeys-macbook-air-2-reader-layout-and-diagnostics
- [2026-08-26-alexeys-macbook-air-2-msg-head-footer-redesign.md](log/2026-08-26-alexeys-macbook-air-2-msg-head-footer-redesign.md) — 2026-08-26-alexeys-macbook-air-2-msg-head-footer-redesign
- [2026-08-26-alexeys-macbook-air-2-console-with-assistant.md](log/2026-08-26-alexeys-macbook-air-2-console-with-assistant.md) — 2026-08-26-alexeys-macbook-air-2-console-with-assistant
- [2026-08-26-alexeys-macbook-air-2-chat-instructions-toggles.md](log/2026-08-26-alexeys-macbook-air-2-chat-instructions-toggles.md) — Инструкции чата с чекбоксами в настройках
- [2026-08-25-macbook-air-user-manual-qa-machine-labels.md](log/2026-08-25-macbook-air-user-manual-qa-machine-labels.md) — manual-qa-machine-labels
- [2026-08-25-macbook-air-user-instant-submit.md](log/2026-08-25-macbook-air-user-instant-submit.md) — instant-submit
- [2026-08-25-macbook-air-user-desktop-composer.md](log/2026-08-25-macbook-air-user-desktop-composer.md) — desktop-composer
- [2026-08-25-macbook-air-user-context-snapshot-effective-llm.md](log/2026-08-25-macbook-air-user-context-snapshot-effective-llm.md) — context-snapshot-effective-llm
- [2026-08-25-germany-4-8-60-dismissible-menus.md](log/2026-08-25-germany-4-8-60-dismissible-menus.md) — dismissible-menus
- [2026-08-25-alexeys-macbook-air-2-web-reader-testing-pack.md](log/2026-08-25-alexeys-macbook-air-2-web-reader-testing-pack.md) — web-reader-testing-pack

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

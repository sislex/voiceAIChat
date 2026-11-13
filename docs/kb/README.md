<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [admin-app.md](admin-app.md) | Frontend-модуль Administration: граница, store и подключение | 2026-10-07 | ✓ |
| [agent-api-access.md](agent-api-access.md) | External agent access through API tokens | 2026-11-05 | ⚠ 5 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-11-09 | ⚠ 20 коммит(ов) в areas после проверенного SHA: 39eb24ad0 chore(ui): pin Core UI 1.5.50 … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-11-05 | ⚠ 5 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-11-09 | ⚠ 8 коммит(ов) в areas после проверенного SHA: 39eb24ad0 chore(ui): pin Core UI 1.5.50 … |
| [conversation-groups.md](conversation-groups.md) | Группы и архив бесед | 2026-11-05 | ⚠ 9 коммит(ов) в areas после проверенного SHA: e9100623a fix(chat): keep active path intact for system notes, queued turns and deletions … |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-11-05 | ⚠ 17 коммит(ов) в areas после проверенного SHA: e8ef17321 test(server): give the three-connection chat settings test a 30 s budget … |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-11-13 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-11-09 | ⚠ 13 коммит(ов) в areas после проверенного SHA: d676c82ec Merge remote-tracking branch 'origin/dev' into make/conversation-cf2fda81 … |
| [features/development-preview.md](features/development-preview.md) | Development CI: isolated Docker preview and browser evidence | 2026-11-09 | ✓ |
| [features/feature-preview.md](features/feature-preview.md) | Feature-preview окружения задач | 2026-11-09 | ⚠ 3 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/kanban-assistant.md](features/kanban-assistant.md) | Канбан-ассистент: инструменты проекта, управление UI и оркестрация задач | 2026-11-09 | ⚠ 8 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-11-05 | ⚠ 12 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/llm-runners.md](features/llm-runners.md) | Исполнители LLM: контейнеры с claude/codex CLI | 2026-11-05 | ⚠ 5 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/make-browser.md](features/make-browser.md) | Make: браузер ассистента | 2026-11-09 | ⚠ 7 коммит(ов) в areas после проверенного SHA: e9100623a fix(chat): keep active path intact for system notes, queued turns and deletions … |
| [features/manual-qa.md](features/manual-qa.md) | Структурированное ручное QA | 2026-11-09 | ⚠ 3 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/merge-runner.md](features/merge-runner.md) | Merge-ран задачи: безопасное слияние в main | 2026-11-09 | ⚠ 7 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/playwright-reader.md](features/playwright-reader.md) | Playwright Reader и browser-runner | 2026-11-04 | ⚠ 8 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-11-05 | ⚠ 2 коммит(ов) в areas после проверенного SHA: 653d3697c Enforce assistant configuration across context tools … |
| [features/qa-stage-runs.md](features/qa-stage-runs.md) | Раны QA-этапов: отдельные сущности и вкладки карточки | 2026-11-09 | ⚠ 3 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [features/release-composition.md](features/release-composition.md) | Состав релиза из опубликованных выпусков приложений | 2026-11-02 | ✓ |
| [features/release-gate-plan.md](features/release-gate-plan.md) | Проверки по замене закреплённых архивов | 2026-11-02 | ⚠ 1 коммит(ов) в areas после проверенного SHA: c3f3326bb test(gates): run Kanban-stand e2e and release tooling only in the release regression |
| [features/releases.md](features/releases.md) | Версионные release-ветки и публикация в production | 2026-11-09 | ⚠ 15 коммит(ов) в areas после проверенного SHA: d676c82ec Merge remote-tracking branch 'origin/dev' into make/conversation-cf2fda81 … |
| [features/task-autopilot.md](features/task-autopilot.md) | Автопроход задачи по QA-конвейеру | 2026-11-09 | ⚠ 1 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select |
| [features/task-preparation.md](features/task-preparation.md) | Интерактивная подготовка задачи и Development Brief | 2026-11-09 | ⚠ 3 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [glossary.md](glossary.md) | Словарь терминов: роли, сервисы, стенды, выпуск, техника | 2026-11-01 | ✓ |
| [image-retouch.md](image-retouch.md) | Локальная AI-ретушь изображений | 2026-11-05 | ⚠ 11 коммит(ов) в areas после проверенного SHA: e9100623a fix(chat): keep active path intact for system notes, queued turns and deletions … |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-11-09 | ✓ |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-11-05 | ⚠ 7 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-11-05 | ⚠ 11 коммит(ов) в areas после проверенного SHA: e9100623a fix(chat): keep active path intact for system notes, queued turns and deletions … |
| [modules.md](modules.md) | Module ownership map | 2026-10-31 | ✓ |
| [operations-app.md](operations-app.md) | Frontend-модуль Operations: граница, store и подключение | 2026-10-07 | ✓ |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-11-09 | ⚠ 7 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-11-13 | ✓ |
| [server-internals.md](server-internals.md) | server-internals | 2026-11-11 | ⚠ 9 коммит(ов) в areas после проверенного SHA: e8ef17321 test(server): give the three-connection chat settings test a 30 s budget … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-11-05 | ⚠ 6 коммит(ов) в areas после проверенного SHA: aa423cd73 feat(chat): server-side message branches for edit, retry and select … |
| [stt-runner.md](stt-runner.md) | STT Runner: внутренний протокол, ресурсы и lifecycle | 2026-11-09 | ⚠ 11 коммит(ов) в areas после проверенного SHA: d676c82ec Merge remote-tracking branch 'origin/dev' into make/conversation-cf2fda81 … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-11-09 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-11-09 | ⚠ 5 коммит(ов) в areas после проверенного SHA: 137af9214 chore: pin Make 1.8.19 and Playwright Reader 1.2.8 (fix openStandWindow rest type) … |
| [tts-runner.md](tts-runner.md) | TTS Runner: ресурсный API, движки и жизненный цикл WAV | 2026-11-09 | ⚠ 11 коммит(ов) в areas после проверенного SHA: d676c82ec Merge remote-tracking branch 'origin/dev' into make/conversation-cf2fda81 … |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-11-05 | ⚠ 16 коммит(ов) в areas после проверенного SHA: e9100623a fix(chat): keep active path intact for system notes, queued turns and deletions … |
| [usage/chatai-basics.md](usage/chatai-basics.md) | Как пользоваться sislexa | 2026-10-20 | ✓ |
| [usage/user-account.md](usage/user-account.md) | Информация о пользователе | 2026-11-04 | ✓ |

## Инструкции по пакетам

- [apps/automation-runner](../../apps/automation-runner/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [packages/component-runtime](../../packages/component-runtime/AGENTS.md)
- [packages/file-storage](../../packages/file-storage/AGENTS.md)
- [packages/kb-tools](../../packages/kb-tools/AGENTS.md)
- [packages/knowledge](../../packages/knowledge/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)

## Журнал сессий

Всего записей: 1476. Последние:

- [2026-11-13-alexeys-macbook-air-tailae39a6-ts-net-stand-clean-seed.md](log/2026-11-13-alexeys-macbook-air-tailae39a6-ts-net-stand-clean-seed.md) — stand-clean-seed
- [2026-11-13-alexeys-macbook-air-tailae39a6-ts-net-message-branches.md](log/2026-11-13-alexeys-macbook-air-tailae39a6-ts-net-message-branches.md) — message-branches
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-tests-wave1-release-only.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-tests-wave1-release-only.md) — tests-wave1-release-only
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-test-seed-module.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-test-seed-module.md) — test-seed-module
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-sisl880-kb-gaps.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-sisl880-kb-gaps.md) — sisl880-kb-gaps
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-sisl880-events-kb-review.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-sisl880-events-kb-review.md) — sisl880-events-kb-review
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-make-git-compare.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-make-git-compare.md) — make-git-compare
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-make-git-compare-kb-gaps.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-make-git-compare-kb-gaps.md) — make-git-compare-kb-gaps
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-e2e-core-ui-visual-trim.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-e2e-core-ui-visual-trim.md) — e2e-core-ui-visual-trim
- [2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-deploy-network-recovery.md](log/2026-11-09-alexeys-macbook-air-tailae39a6-ts-net-deploy-network-recovery.md) — deploy-network-recovery

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

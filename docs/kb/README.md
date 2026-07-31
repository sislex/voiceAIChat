<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-27 | ⚠ 22 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 4 коммит(ов) в areas после сверки: 0684f36 fix(web): объявить window.ci в типах web-хоста … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-27 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-30 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-07-31 | ✓ |
| [features/kb-usage.md](features/kb-usage.md) | Использование базы знаний (телеметрия и панель) | 2026-07-31 | ✓ |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-07-27 | ⚠ код изменён 2026-07-31, сверка 2026-07-27 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: 4ca77de docs(kb): коммит в прод-каталоге пушится сразу — иначе прод не fast-forward … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-29 | ⚠ 8 коммит(ов) в areas после сверки: 5e25563 fix(ci): отмена рана останавливает модель, изолированный кэш npm, инфраструктурные ошибки мимо fix-loop … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-27 | ⚠ 9 коммит(ов) в areas после сверки: 5e25563 fix(ci): отмена рана останавливает модель, изолированный кэш npm, инфраструктурные ошибки мимо fix-loop … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-07-31 | ⚠ 3 коммит(ов) в areas после сверки: 4253bbf feat(ui): a11y-гейт — axe в dom-тестах и сториз, контраст токенов, живые области … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-07-27 | ⚠ 35 коммит(ов) в areas после сверки: 5e25563 fix(ci): отмена рана останавливает модель, изолированный кэш npm, инфраструктурные ошибки мимо fix-loop … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-07-27 | ⚠ 16 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-07-31 | ⚠ 1 коммит(ов) в areas после сверки: 74a2a3f feat(ui): сториз чата, CI-панели и машин на общих фикстурах |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-07-31 | ⚠ 2 коммит(ов) в areas после сверки: 4253bbf feat(ui): a11y-гейт — axe в dom-тестах и сториз, контраст токенов, живые области … |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 31. Последние:

- [2026-07-31-2470-com-storybook-foundations.md](log/2026-07-31-2470-com-storybook-foundations.md) — storybook-foundations
- [2026-07-31-2470-com-storybook-chat-ci.md](log/2026-07-31-2470-com-storybook-chat-ci.md) — storybook-chat-ci
- [2026-07-31-2470-com-kb-usage-panel.md](log/2026-07-31-2470-com-kb-usage-panel.md) — kb-usage-panel
- [2026-07-31-2470-com-kanban-pointer-dnd.md](log/2026-07-31-2470-com-kanban-pointer-dnd.md) — kanban-pointer-dnd
- [2026-07-31-2470-com-command-palette.md](log/2026-07-31-2470-com-command-palette.md) — command-palette
- [2026-07-30-2470-com-ssylka-na-chat.md](log/2026-07-30-2470-com-ssylka-na-chat.md) — ссылка-на-чат
- [2026-07-30-2470-com-rezyume-rana-v-chate.md](log/2026-07-30-2470-com-rezyume-rana-v-chate.md) — Резюме CI-рана в связанном чате + имя чата задачи
- [2026-07-30-2470-com-prod-ff-only.md](log/2026-07-30-2470-com-prod-ff-only.md) — Шаг «Обновить прод-контейнер» упал на pull --ff-only (128)
- [2026-07-30-2470-com-mobilnaya-kartochka-zadachi.md](log/2026-07-30-2470-com-mobilnaya-kartochka-zadachi.md) — Мобильная версия карточки задачи (как в Jira)
- [2026-07-30-2470-com-fts-message-search.md](log/2026-07-30-2470-com-fts-message-search.md) — fts-message-search

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

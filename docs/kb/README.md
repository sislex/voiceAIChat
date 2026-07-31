<!-- Файл генерируется: npm run kb:index. Руками не правь, при конфликте перегенерируй. -->

# База знаний voiceAIChat

Точка входа для агента — корневой [AGENTS.md](../../AGENTS.md).
Правила ведения этой базы — [kb-workflow.md](kb-workflow.md).

## Темы

| Файл | Тема | Сверено | Статус |
|---|---|---|---|
| [architecture.md](architecture.md) | Архитектура: кто с кем разговаривает | 2026-07-27 | ⚠ 22 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре … |
| [clients.md](clients.md) | Клиенты и упаковка: web, desktop и agent-tray | 2026-07-27 | ⚠ 4 коммит(ов) в areas после сверки: 0684f36 fix(web): объявить window.ci в типах web-хоста … |
| [conventions.md](conventions.md) | Конвенции: код, тесты, гейты, коммиты | 2026-07-27 | ✓ |
| [data-auth.md](data-auth.md) | Данные и доступ: SQLite, пользователи, роли | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре |
| [deploy.md](deploy.md) | Деплой: Docker, HTTPS, прод-сервер, env | 2026-07-30 | ✓ |
| [features/ci-runner.md](features/ci-runner.md) | CI-раннер канбана (Авто-подготовка окружения для таска) | 2026-07-30 | ⚠ 5 коммит(ов) в areas после сверки: 401fe20 feat(ui): единые состояния загрузки, пустоты и ошибки — Skeleton/EmptyState/ErrorState … |
| [features/project-knowledge-base.md](features/project-knowledge-base.md) | База знаний проекта | 2026-07-27 | ⚠ код изменён 2026-07-31, сверка 2026-07-27 (по датам: правки того же дня не видны — поставь checked) |
| [kb-workflow.md](kb-workflow.md) | Как устроена и ведётся база знаний | 2026-07-27 | ⚠ 2 коммит(ов) в areas после сверки: 4ca77de docs(kb): коммит в прод-каталоге пушится сразу — иначе прод не fast-forward … |
| [llm.md](llm.md) | LLM: claude/codex CLI, ходы, stream-json, gateway | 2026-07-29 | ⚠ 7 коммит(ов) в areas после сверки: 343ef28 fix(llm): подсказать модели timeout_ms у remote-bash … |
| [machines.md](machines.md) | Машины: компаньон-агент, политика, PTY, проводник | 2026-07-27 | ⚠ 7 коммит(ов) в areas после сверки: 401fe20 feat(ui): единые состояния загрузки, пустоты и ошибки — Skeleton/EmptyState/ErrorState … |
| [projects.md](projects.md) | Проекты и канбан-доска | 2026-07-30 | ⚠ 8 коммит(ов) в areas после сверки: 401fe20 feat(ui): единые состояния загрузки, пустоты и ошибки — Skeleton/EmptyState/ErrorState … |
| [protocol.md](protocol.md) | Контракт клиент↔сервер (REST, WS, мосты) | 2026-07-30 | ⚠ 1 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре |
| [server-internals.md](server-internals.md) | Backend изнутри: сборка, маршруты, сессии и сервисы | 2026-07-27 | ⚠ 34 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре … |
| [shared.md](shared.md) | Общий пакет: типы, контракты и чистая логика | 2026-07-27 | ⚠ 16 коммит(ов) в areas после сверки: 6b56a49 feat(search): полнотекстовый поиск по сообщениям (SQLite FTS5) + панель в сайдбаре … |
| [stt-tts.md](stt-tts.md) | Речь: Whisper (STT) и Piper/say (TTS) | 2026-07-26 | ✓ |
| [testing-operations.md](testing-operations.md) | Разработка, тестирование, диагностика и эксплуатация | 2026-07-27 | ✓ |
| [ui.md](ui.md) | Интерфейс: React, store, remote-мосты и голосовой UX | 2026-07-31 | ✓ |

## Инструкции по пакетам

- [apps/agent](../../apps/agent/AGENTS.md)
- [apps/agent-tray](../../apps/agent-tray/AGENTS.md)
- [apps/desktop](../../apps/desktop/AGENTS.md)
- [apps/server](../../apps/server/AGENTS.md)
- [apps/web](../../apps/web/AGENTS.md)
- [packages/shared](../../packages/shared/AGENTS.md)
- [packages/ui](../../packages/ui/AGENTS.md)

## Журнал сессий

Всего записей: 27. Последние:

- [2026-07-31-2470-com-storybook-foundations.md](log/2026-07-31-2470-com-storybook-foundations.md) — storybook-foundations
- [2026-07-30-2470-com-ssylka-na-chat.md](log/2026-07-30-2470-com-ssylka-na-chat.md) — ссылка-на-чат
- [2026-07-30-2470-com-rezyume-rana-v-chate.md](log/2026-07-30-2470-com-rezyume-rana-v-chate.md) — Резюме CI-рана в связанном чате + имя чата задачи
- [2026-07-30-2470-com-prod-ff-only.md](log/2026-07-30-2470-com-prod-ff-only.md) — Шаг «Обновить прод-контейнер» упал на pull --ff-only (128)
- [2026-07-30-2470-com-mobilnaya-kartochka-zadachi.md](log/2026-07-30-2470-com-mobilnaya-kartochka-zadachi.md) — Мобильная версия карточки задачи (как в Jira)
- [2026-07-30-2470-com-fts-message-search.md](log/2026-07-30-2470-com-fts-message-search.md) — fts-message-search
- [2026-07-29-2470-com-ai-prompt-builder.md](log/2026-07-29-2470-com-ai-prompt-builder.md) — ai-prompt-builder
- [2026-07-27-repo-2-project-knowledge-base.md](log/2026-07-27-repo-2-project-knowledge-base.md) — project-knowledge-base
- [2026-07-27-2470-com-windows-install-command-cmd.md](log/2026-07-27-2470-com-windows-install-command-cmd.md) — windows-install-command-cmd
- [2026-07-27-2470-com-projects-kanban.md](log/2026-07-27-2470-com-projects-kanban.md) — projects-kanban

## Исторические планы

`docs/plans/` — планы фич с чек-листами. Это намерения, а не состояние кода.

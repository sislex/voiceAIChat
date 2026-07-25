---
title: база знаний для агентов
date: 2026-07-26
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# база знаний для агентов

## Что сделано

- Заведена точка входа: корневой `AGENTS.md` (карта монорепо, команды, гейт,
  «что знать до первой правки», указатели) + `CLAUDE.md` из одной строки
  `@AGENTS.md` — один источник для Claude Code и Codex.
- `AGENTS.md` в каждом пакете (`apps/*`, `packages/*`) + `CLAUDE.md`-указатель
  рядом, чтобы Claude Code подхватывал их только при работе в этом каталоге.
- `docs/kb/` — 9 тем: architecture, protocol, llm, stt-tts, machines, data-auth,
  deploy, conventions, kb-workflow. У каждой фронтматтер `title/updated/areas`.
- `scripts/kb.mjs` (без зависимостей) + npm-скрипты `kb`, `kb:check`, `kb:index`,
  `kb:log`; слэш-команда `/kb-update` для Claude Code.
- Корень разгружен: 6 планов → `docs/plans/`, `DOCKER.md` → `docs/docker.md`
  (это рантайм-гайд, а не план). Ссылка на `PTY_CONSOLE.md` в комментарии
  `apps/agent/src/connection.ts` обновлена на новый путь.

- После пуша: проверка свежести переведена с дат на sha (`checked:` во
  фронтматтере, `git log <checked>..HEAD -- areas`), и по ней сверены темы с
  входящими правками сервера (per-message `execTarget` + `cliProfiles`).

## Что выяснили (факты, которых не было в KB)

- Сверка по датам не годится: в этом репозитории несколько агентов коммитят в
  один день, и правки, сделанные после сверки в тот же день, проверка молча
  пропускала. Отсюда `checked: <sha>` как основной механизм, дата — фолбэк (sha
  исчезает после rebase). `areas` надо держать актуальными — по ним и идёт проверка.
- `new Date().toISOString()` в скриптах даёт UTC: вечером по московскому времени
  это «вчера», и запись журнала получала дату предыдущего дня. В `kb.mjs` дата
  считается по локальной зоне.

## Куда занесено

- `AGENTS.md` (корень и пакеты), `docs/kb/*.md`, правила ведения —
  `docs/kb/kb-workflow.md`.

## Открытые вопросы / что осталось

- `kb:check` пока только предупреждает. Если понадобится жёсткость — есть
  `node scripts/kb.mjs check --strict` (код возврата 1) для CI или pre-commit;
  сознательно не включено, чтобы не блокировать коммиты.
- Отдельной темы по рендеру в `packages/ui` (Markdown, ToolFrame, анимации) нет —
  пока хватает `packages/ui/AGENTS.md`, при росте вынести в `docs/kb/`.

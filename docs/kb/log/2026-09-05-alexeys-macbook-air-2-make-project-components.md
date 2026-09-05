---
title: make-project-components
date: 2026-09-05
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-project-components

## Что сделано

- Вкладка «Проект» в Make: компоненты реальной рабочей копии, кадр стори из настоящего
  Storybook проекта на машине, правка файла и задача из правки
  (`packages/ui/src/components/MakeProjectComponents.tsx`, сториз `Make/ProjectComponents`).
- Контракт `packages/shared/src/projectComponents.ts` (id стори по правилам `@storybook/csf`,
  разбор `/index.json`, адрес кадра через прокси машины), каналы `projects:components*`,
  `projects:storybook*`, `projects:componentTicket`.
- Сервер: `apps/server/src/components/storybookSessions.ts` (Storybook в PTY-сессии машины с
  пробой готовности), `componentTicket.ts` (ветка → коммит → push → `ci_workspaces(pushed=1)`
  → колонка `awaiting_merge`), маршруты `routes/projectComponents.ts`,
  `GitWorkspaceService.storyFiles` + `storyFilesScript`.
- План фичи — `docs/plans/make-project-components.md`.

## Что выяснили (факты, которых не было в KB)

- Прокси `/api/preview` уже умеет доставлять HTTP с любого порта машины по алиасу
  `<agentId>.machine.internal` (`routes/previewProxy.ts`, `loadViaMachine`), и этого хватает
  для same-origin iframe со Storybook — новый транспорт не нужен. Но WebSocket через него не
  ходит (нет `upgrade`-хука), поэтому HMR в кадре не работает.
- Запись `ci_workspaces` с `pushed = 1` создавал **только** dev-ран (`ci/runManager.ts:1600`),
  а `recordRevision` в панели кода срабатывает лишь для `ws:`-копий. Это и был единственный
  разрыв на пути «правка руками → merge-ран»; общая копия проекта (`project:<agentId>`) и
  копия чата в merge не заводили вовсе.
- `POST /tasks/:taskId/move` карту переходов не проверяет, но заводить задачу сразу в
  `awaiting_merge` можно и через `createTask`: семантику колонки `db.createTask` не проверяет,
  а `startMergeRun` смотрит только на семантику колонки и pushed-workspace.
- `projectKey('Chat AI')` даёт `CA`, а не `CHAT`: ключ собирается из первых букв слов.
- У PTY-сессий есть два таймера-убийцы: `PTY_IDLE_TTL_MS` (30 мин без подписчика) и политика
  машины `ptyIdleMinutes` (нет ввода). Сервер держит подписчика сам, но политику не обходит.

## Куда занесено

- `docs/kb/ui.md` — раздел «Отдельный режим «Make…»», абзац про вкладку «Проект».
- `docs/kb/projects.md` — «Компоненты проекта в Make и быстрый тикет к слиянию».

## Открытые вопросы / что осталось

- Сессии Storybook живут в памяти процесса: после рестарта сервера dev-сервер на машине
  остаётся сиротой (панель покажет «остановлен»). Нужен повторный подхват по пробе порта.
- Ответ прокси ограничен 5 МиБ и таймаутом 10/15 с — на медленной первой сборке кадр может
  отдать 502; проба `/index.json` прогревает, но гарантии нет.
- Правка идёт в ту же копию, где может работать CI-ран: панель полагается на `busy`-барьер
  резолвера, отдельного предупреждения «следующий ран потребует чистого дерева» здесь пока нет
  (в `GitPane` оно есть).

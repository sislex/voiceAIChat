---
title: make-project-components
date: 2026-09-05
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-project-components

## Что сделано

- Вкладка «Репозиторий» в Make: компоненты реальной рабочей копии, кадр стори из настоящего
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

## Проверка на стенде (8804/5293, companion-агент + реальный Storybook)

Прогон на живом стенде нашёл пять дефектов, все исправлены и покрыты тестами:

1. **Кадр показывал «No Preview»**: Storybook читает выбор стори из `location.search`
   отданного документа, а там был адрес прокси. `id`/`viewMode` перенесены в наш query.
2. **Модули Vite не грузились**: абсолютные импорты уходили на origin ChatAI (404).
   Добавлено `rewriteModuleSpecifiers` в `previewProxy` для хостов `*.machine.internal`.
3. **Команда по умолчанию не годится монорепо** (`npm run storybook` живёт в пакете витрины):
   команда пробрасывается с клиента и запоминается на проект.
4. **Падение команды выглядело как вечная сборка**: `pty.exit` не приходит, пока жив shell.
   Добавлен сентинел с кодом выхода — состояние сразу становится `failed`.
5. **Сессия не была привязана к каталогу копии**: после смены пути машины панель отдавала
   индекс прежнего репозитория. Путь вошёл в ключ сессии, плюс сверка индекса с `git ls-files`.

Цепочка тикета проверена на изолированном репозитории (`/tmp/sb-origin.git` + `/tmp/sb-work`):
правка → задача `SK-1` в колонке «Ожидает мержа» → ветка запушена в origin → `ci_workspaces`
с `pushed=1` → на доске `mergeSourceBranch=SK-1`, `mergePermitted`, `mergeMachineBound` — карточка
готова к слиянию. Сам merge-ран не запускался (он требует LLM-шага обновления БЗ).

## Открытые вопросы / что осталось

- Смена стори перезагружает кадр целиком (~1–2 с на повторную загрузку модулей). Быстрее было бы
  через канал Storybook (`__STORYBOOK_PREVIEW__.channel`), но это привязка к его внутреннему API.
- Ответ прокси ограничен 5 МиБ и таймаутом 10/15 с. На стенде Vite отдавал мелкие модули (десятки
  килобайт) и в лимит не упирался, но у webpack-билдера Storybook бандл один и большой — там
  ограничение, скорее всего, сработает.
- HMR не работает (WebSocket через прокси не ходит): после сохранения кадр перезагружается сам.
- Правка идёт в ту же копию, где может работать CI-ран: панель полагается на `busy`-барьер
  резолвера, отдельного предупреждения «следующий ран потребует чистого дерева» здесь пока нет
  (в `GitPane` оно есть).

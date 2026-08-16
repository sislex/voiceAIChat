---
title: projects-app-package
date: 2026-08-16
machine: 2470-com
author: alexeyrozhnov
---

# projects-app-package

## Что сделано

- Актуализация базы знаний после шага «Выделить Projects в независимый frontend-модуль»
  (коммит `0d21f9c`, merge `a686b93`).

## Что выяснили (факты, которых не было в KB)

- Появился workspace-пакет `packages/projects-app` (`@voicechat/projects-app`) с контрактами
  `ProjectsClient`/`ProjectsHost`/`ProjectsChatPort`, фабрикой `createProjectsStore`,
  `ProjectsProvider`/`ProjectsApp`, parser/builder `#/projects/*` и переехавшими
  `normalize.ts` + `fixtures.ts` канбана; `exports` из двух записей, свой архитектурный тест.
- Граница проведена наполовину: экраны проектов и состояние остались в `packages/ui`/`voiceStore`.
  Из пакета в приложении работают только `parseProjectsRoute` в `App.tsx` и два файла-реэкспорта
  в `components/kanban/`; `createProjectsStore`, `ProjectsProvider`, `ProjectsApp`,
  `createProjectsClient` и `styles.css` пакета потребителей не имеют.
- `ProjectsClient` покрывает только проекты, доску, колонки, задачи и чат задачи — CI, QA,
  preparation, merge, releases и ассистента в контракте ещё нет.
- Распознавание раздела в `App.tsx` стало строгим: неполный/лишний сегмент в `#/projects/...`
  теперь даёт `null` из parser и проваливается в обычный Chat. Вкладка `assistant` и deep link
  `preparation` по-прежнему читаются из сырых сегментов, поэтому декодирование id у них другое.
- `scripts/affected-check.mjs` про новый пакет не знает (как и про ui-kit) — любой его файл
  включает полный гейт.

## Куда занесено

- `docs/kb/projects.md` — раздел «Фронтенд» переписан: что где живёт, что не подключено,
  как изменилось распознавание проектных адресов.
- `docs/kb/ui.md` — новый раздел «Пакет @voicechat/projects-app: контракты, store и маршруты»
  (устройство, семантика store, адаптер `createProjectsClient`, архитектурный тест, гейты).
- `AGENTS.md` — строки карты монорепо для `packages/ui-kit` и `packages/projects-app`.
- Статья раздела «Разработка проекта» об общем Sidebar не менялась: navigation facade пока
  не подключён.

## Открытые вопросы / что осталось

- Экраны (`ProjectPage`, `ProjectBoard`, `TaskModal`, CI/QA-панели, releases, ассистент),
  проектное состояние из `voiceStore` и Sidebar-facade не перенесены — база знаний описывает
  текущее двойное расположение и должна обновиться на следующем шаге.
- Гейты пакета в KB-worktree не запускались: `node_modules` там не установлен.

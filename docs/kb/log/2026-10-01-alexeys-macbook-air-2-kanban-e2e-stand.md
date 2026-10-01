---
title: kanban-e2e-stand
date: 2026-10-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Стенд «ядро + канбан» для e2e страниц проекта

## Изменение

- `e2e/kanbanStand.ts`: временный Postgres, ядро с `VC_KANBAN_MODE=remote` и процесс канбана из
  чекаута закреплённого коммита; без условий сьюты пропускаются с причиной.
- `scripts/kanban-stand-prepare.mjs` (`npm run e2e:kanban-stand`): кэш чекаута канбана по коммиту;
  `scripts/browser-gate.mjs` вызывает его перед `projects`/`gitPane`.
- Возвращены `e2e/projects.e2e.test.ts` (6) и `e2e/gitPane.e2e.test.ts` (4), удалённые в #276;
  снова в каталоге `web`, параллельном наборе браузерного гейта, `gate-scenarios.json` и скриптах.

## Проверка

- Оба сьюта через `scripts/browser-gate.mjs`: 10 из 10; `projects` три прогона подряд.
- Без чекаута канбана сьюты пропускаются и печатают причину.

## Тема базы знаний

- `docs/kb/testing-operations.md` — «Стенд «ядро + канбан» для e2e страниц проекта».

## Осталось

- Режим с готовым образом `sislexa-kanban:<коммит>` вместо чекаута (для прод-хоста без исходников).

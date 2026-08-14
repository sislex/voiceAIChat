---
title: ui-board-fixtures-canonical-columns
date: 2026-08-14
machine: mac
author: alexeyrozhnov
---

# ui-board-fixtures-canonical-columns

## Что сделано

- UI-двойники доски приведены к каноническому QA-workflow: `createFakeApi`
  (`packages/ui/src/test/fakeApi.ts`) при создании проекта засевает 12 системных
  колонок (`backlog` → `merge` → `done` + `decision_required`) вместо прежних
  шести, `makeDefaultColumns()` (`packages/ui/src/components/kanban/fixtures.ts`)
  — тот же набор для сториз.
- Сториз канбана (`KanbanBoard.stories.tsx`) переведены с `col-testing` на
  `col-automated_qa`; store-тест доски (`voiceStore.projects.test.ts`) сверяет
  `semanticType` вместо отображаемых имён колонок.

## Что выяснили (факты, которых не было в KB)

- Легаси-семантик `testing`/`qa_preparation` в UI-фикстурах и сториз больше не
  осталось; фикстурные id колонок строятся как `col-<semanticType>`, поэтому
  сториз и dom-тесты адресуют колонку семантикой, а не подписью.
- Колонка, созданная действием `createColumn`, в фейковом API получает семантику
  `custom` и встаёт после `decision_required`.

## Куда занесено

- docs/kb/ui.md — абзац в «Тестирование UI» об инвариантах фейкового моста и
  фикстур доски.

## Открытые вопросы / что осталось

- Нет.

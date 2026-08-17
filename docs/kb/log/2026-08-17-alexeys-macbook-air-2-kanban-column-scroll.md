---
title: kanban-column-scroll
date: 2026-08-17
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-column-scroll

## Что сделано

- Починен вертикальный скролл колонок канбана, сломанный появлением
  `WidgetAssistantFrame`: доска перестала быть прямым ребёнком `.toolpage`,
  и правило `.toolpage > .jboard-wrap` не срабатывало — обёртка теряла
  ограничение высоты, колонки росли вниз без своего скролла.
- Правило переписано без привязки к родителю: `.jboard-wrap { flex: 1;
  min-width: 0; min-height: 0; display: flex; flex-direction: column;
  overflow: hidden; }` (`packages/ui/src/styles/app.css`).
- В `boardScroll.test.ts` добавлен тест звеньев рамки ассистента
  (`.widget-assistant`, `.widget-assistant-widget`) и обновлён селектор
  обёртки — старый тест держал `.toolpage > .jboard-wrap` и потому пропустил
  регрессию.
- В `KanbanBoard.stories.tsx` добавлен декоратор-обёртка `.toolpage`
  с ограниченной высотой: без него скролл колонок в витрине не увидеть
  (сториз `ColumnDensity`).

## Что выяснили (факты, которых не было в KB)

- Реальная цепочка вложенности доски на странице проекта: `.toolpage.projpage`
  → `.widget-assistant` → `.widget-assistant-widget` → `.jboard-wrap`;
  раздел «Прокрутка доски» описывал прямую вложенность в `.toolpage`.

## Куда занесено

- docs/kb/projects.md — раздел «Прокрутка доски» (цепочка через рамку
  ассистента, правило без привязки к родителю, декоратор Storybook).

## Открытые вопросы / что осталось

- Нет.

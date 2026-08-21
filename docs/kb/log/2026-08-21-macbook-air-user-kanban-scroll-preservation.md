---
title: kanban-scroll-preservation
date: 2026-08-21
machine: macbook-air-user
author: NikolayTola
---

# kanban-scroll-preservation

## Что сделано

- Дополнена тема канбана проверенным контрактом сохранения прокрутки при обновлениях данных.

## Что выяснили (факты, которых не было в KB)

- Обычный rerender сохраняет тот же scroll-контейнер и обе координаты; после временного skeleton координаты восстанавливаются по `scrollScopeId`, а другой проект начинает с нуля.
- Наблюдение за scroll не вмешивается в pointer-DnD и автоскролл.

## Куда занесено

- `docs/kb/projects.md`

## Открытые вопросы / что осталось

- Нет.

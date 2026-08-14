---
title: acceptance-criteria-numbering
date: 2026-08-14
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# acceptance-criteria-numbering

## Что сделано

- Сверена реализация автоматической нумерации критериев в shared, REST и TaskModal.

## Что выяснили (факты, которых не было в KB)

- Канонический формат — Markdown ordered list, который идемпотентно нормализуют общий shared-код, UI и оба серверных маршрута записи.
- Вложенные строки остаются внутри критерия; Enter и Shift+Enter имеют разные роли.

## Куда занесено

- docs/kb/projects.md

## Открытые вопросы / что осталось

- Нет.

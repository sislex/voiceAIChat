---
title: sidebar-project-menu-layer
date: 2026-09-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# sidebar-project-menu-layer

## Что сделано

- Дополнено описание layout проектного фильтра чатов и его регрессионных сценариев.

## Что выяснили (факты, которых не было в KB)

- Меню расположено вне `.convolist`; его обрезал `overflow: hidden` у `.side-controls`.
- В открытом состоянии `overflow: visible`, `position: relative` и `z-index: 1` поднимают меню над списком, не перенося прокрутку с `.convolist`.

## Куда занесено

- `docs/kb/ui.md`, раздел «Общий Sidebar: разделы, controls и desktop resize».

## Открытые вопросы / что осталось

- Нет.

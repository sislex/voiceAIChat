---
title: image-studio-improvements-20
date: 2026-09-03
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio-improvements-20

## Что сделано

- Итерация 20: разметка поверх картинки в лайтбоксе (freehand, 4 цвета, две
  толщины, undo штриха), сохранение новым файлом через lib/imageAnnotate.

## Что выяснили (факты, которых не было в KB)

- Синтетический drag (CDP left_click_drag) не генерит промежуточные pointermove —
  для рисования в браузерных проверках нужна серия PointerEvent (занесено в
  ui.md).

## Куда занесено

- docs/kb/ui.md — раздел «Студия картинок»

## Открытые вопросы / что осталось

- Цикл продолжается: итерация 21 по /loop.

---
title: console-reader-adaptive-split
date: 2026-09-04
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# console-reader-adaptive-split

## Что сделано

- Зафиксировано актуальное поведение адаптивного split-враппера режима
  `#/console-reader/<conversationId>` по реализации и Make «Проект 18».

## Что выяснили (факты, которых не было в KB)

- Десктопная доля чата начинается с 42%, ограничена 25–75% и пиксельными
  минимумами 360/320 px; разделитель поддерживает pointer, стрелки с шагом 2%,
  Home/End и сброс двойным щелчком.
- До 768 px разделитель скрывается, вкладки показывают одну панель, но
  `ConsoleSessionPane` остаётся смонтированным, поэтому PTY не обрывается.

## Куда занесено

- docs/kb/ui.md — раздел `Console Reader: адаптивный split и общий PTY`.

## Открытые вопросы / что осталось

- Нет.

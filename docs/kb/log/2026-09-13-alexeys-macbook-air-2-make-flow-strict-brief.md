---
title: make-flow-strict-brief
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-flow-strict-brief

## Что сделано

- Сверены и актуализированы знания о полном JSON-разборе Development Brief и согласованном пользовательском потоке Make.
- Удалено краткое дублирующее описание строгого Brief parser; сохранён единый подробный раздел.

## Что выяснили (факты, которых не было в KB)

- Production parser теперь разбирает весь trimmed-ответ как один JSON-объект, не снимает вводные фразы или Markdown-ограды и лишь после разбора нормализует `decisions[].questionId=null`.
- Make переиспользует существующие режимы, editor wrapper, настройки autosave/format-on-save и статистику публикации, дополняя их независимыми черновиками, операциями каталогов, reviewed replacement, сравнением снимков и мобильным потоком на 390 px.

## Куда занесено

- `docs/kb/features/task-preparation.md`
- `docs/kb/ui.md`

## Открытые вопросы / что осталось

- Нет.

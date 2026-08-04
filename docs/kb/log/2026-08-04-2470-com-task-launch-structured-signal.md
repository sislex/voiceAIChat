---
title: task-launch-structured-signal
date: 2026-08-04
machine: 2470-com
author: alexeyrozhnov
---

# task-launch-structured-signal

## Что сделано

- Описан структурированный сигнал `task-launch`: обычное пользовательское сообщение теперь всегда уходит модели, а карточка выбора способа работы открывается только по явному ответу модели.

## Что выяснили (факты, которых не было в KB)

- TODO определяется семантикой канбан-колонки `backlog`; поле завершения хода должно совпадать в `protocol.ts` и `ipc.ts`, а служебный fenced-блок исключается из TTS.

## Куда занесено

- docs/kb/shared.md
- docs/kb/ui.md
- docs/kb/projects.md

## Открытые вопросы / что осталось

- Нет.

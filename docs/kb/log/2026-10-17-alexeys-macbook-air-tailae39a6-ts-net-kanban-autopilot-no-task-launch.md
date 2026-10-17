---
title: kanban-autopilot-no-task-launch
date: 2026-10-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kanban-autopilot-no-task-launch

## Что сделано

- Канбан-ассистент с «Автопилотом» (`assistantAutonomy: auto`) больше не получает инструкцию `taskLaunch`; ход и инспектор контекста фильтруют через `turnChatInstructions`.

## Что выяснили (факты, которых не было в KB)

- На проде 2026-10-17 ассистент доски core-ui с «Автопилотом» на просьбу «разрули сам» ответил, что «требуется разрешение перед изменениями», — источник был общий хинт `CHANGE_AUTHORIZATION_HINT`.

## Куда занесено

- docs/kb/features/kanban-assistant.md — «Автономия и подтверждения»

## Открытые вопросы / что осталось

- Нет.

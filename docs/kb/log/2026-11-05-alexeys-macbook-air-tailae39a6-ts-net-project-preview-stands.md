---
title: project-preview-stands
date: 2026-11-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# project-preview-stands

## Что сделано

- Стенды-превью обычных веб-проектов: команда владельца (`PUT /api/projects/:id/stand-preview`) запускается в рабочей копии на машине, порт открывается через StandProxy (`pp-<agentId>`), Make видит его как стенд.

## Что выяснили (факты, которых не было в KB)

- Конкретные роуты ядра под `/api/projects/*` выигрывают у прокси канбана, поэтому настройка живёт в ядре без изменений Kanban.

## Куда занесено

- docs/kb/server-internals.md#project-preview-stands

## Открытые вопросы / что осталось

- Привязка беседы к машине превью для files/git держится в памяти процесса; после рестарта берётся машина по умолчанию.
- Интерфейса настройки нет — только REST.

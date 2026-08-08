---
title: kanban-assistant-selection-dedup
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-assistant-selection-dedup

## Что сделано

Обновлена тема проектов после исправления повторных `field.select` и перевода канбан-ассистента на общий интерфейс чата.

## Что выяснили (факты, которых не было в KB)

Selection callback должен сохранять ссылочную стабильность, а журнал отбрасывает только подряд идущие одинаковые действия; канбан-ассистент использует `ChatColumn` и `VoiceBar`.

## Куда занесено

`docs/kb/projects.md`.

## Открытые вопросы / что осталось

Нет.

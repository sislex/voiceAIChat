---
title: project-machine-directories
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# project-machine-directories

## Что сделано

Обновлена тема машин: зафиксированы управляемые каталоги проекта, статусы storage,
валидация, материализация и интерфейс настройки.

## Что выяснили (факты, которых не было в KB)

Схема содержит семь назначений. Legacy `path` и `repos_root` становятся overrides
при первом выборе storage; смена storage пересчитывает только managed-значения, а
отдельный reset возвращает одно назначение к текущей рекомендации.

## Куда занесено

- `docs/kb/machines.md`

## Открытые вопросы / что осталось

Нет.

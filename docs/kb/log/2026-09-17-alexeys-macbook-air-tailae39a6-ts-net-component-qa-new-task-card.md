---
title: component-qa-new-task-card
date: 2026-09-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# component-qa-new-task-card

## Что сделано

- Зафиксированы изолированная подготовка зависимостей Component QA и регрессионное покрытие новой карточки задачи.

## Что выяснили (факты, которых не было в KB)

- Каждый Component QA ран получает собственные HOME и npm cache внутри checkout; сбои EACCES/TAR_ENTRY_ERROR считаются инфраструктурными.
- Компонент `new-task-card-view` связан с основной историей `kanban-newtaskcard--desktop`, а три состояния карточки проверяются в двух темах и на ширинах 390/1280 px.

## Куда занесено

- `docs/kb/features/manual-qa.md`
- `docs/kb/projects.md`

## Открытые вопросы / что осталось

- Нет.

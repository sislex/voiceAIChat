---
title: rework-cycles
date: 2026-09-06
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# rework-cycles

## Что сделано

- Актуализирована база знаний по неизменяемым ручным циклам доработки новой карточки.

## Что выяснили (факты, которых не было в KB)

- Цикл сохраняется атомарно вместе с метаданными вложений и возвратом задачи в `preparation`; POST защищён idempotency key, владельцем upload, workflow-гейтом и запретом активного рана.
- Новая карточка загружает серверную историю, умеет повторять чтение и upload, не теряет черновик при ошибке и показывает недоступные сохранённые файлы как `missing`.
- Успешный development-run без legacy merge-шагов переводит карточку в `component_qa`.

## Куда занесено

- `docs/kb/projects.md`
- `docs/kb/features/qa-stage-runs.md`
- `docs/kb/features/ci-runner.md`

## Открытые вопросы / что осталось

- Нет.

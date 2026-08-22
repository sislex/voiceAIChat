---
title: managed-feature-preview
date: 2026-08-22
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# managed-feature-preview

## Что сделано

- Описан managed lifecycle новых feature-preview поверх MachineStorage и безопасное удаление их каталогов.

## Что выяснили (факты, которых не было в KB)

- `PreviewEnvironment.id` служит стабильным preview id, а checkout всегда находится в каноническом `temporary/repository`.
- Persisted managed metadata и `environment.json` независимо связывают preview с проектом, задачей, машиной и storage.
- Remove удаляет только подтверждённый preview root после очистки Docker; legacy workspace не мигрируется и не удаляется.

## Куда занесено

- `docs/kb/features/feature-preview.md`
- `docs/kb/machines.md`

## Открытые вопросы / что осталось

- Нет.

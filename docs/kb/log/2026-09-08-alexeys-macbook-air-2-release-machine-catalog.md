---
title: release-machine-catalog
date: 2026-09-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-machine-catalog

## Что сделано

- Актуализированы темы релизов и машин по выбору доступной release-машины.

## Что выяснили (факты, которых не было в KB)

- Release Center получает server-filtered каталог по общей политике `listUsableAgents`; запуск требует `owner`/`full`, online и настроенный checkout или reposRoot.
- Последняя принятая машина хранится отдельно по пользователю и проекту и не влияет на defaults чатов и задач.

## Куда занесено

- docs/kb/features/releases.md
- docs/kb/machines.md

## Открытые вопросы / что осталось

- Нет.

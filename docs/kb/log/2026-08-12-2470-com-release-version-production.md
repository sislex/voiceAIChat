---
title: release-version-production
date: 2026-08-12
machine: 2470-com
author: alexeyrozhnov
---

# release-version-production

## Что сделано

- Актуализировано описание версии при защищённой публикации release-ветки.

## Что выяснили (факты, которых не было в KB)

- `ReleaseManager` экспортирует проверенную версию ветки в production-команду как `VC_RELEASE_VERSION`; Git-тег на SHA для этого пути не требуется.

## Куда занесено

- `docs/kb/deploy.md`
- `docs/kb/features/releases.md`

## Открытые вопросы / что осталось

- Нет.

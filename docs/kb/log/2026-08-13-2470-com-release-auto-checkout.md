---
title: release-auto-checkout
date: 2026-08-13
machine: 2470-com
author: alexeyrozhnov
---

# release-auto-checkout

## Что сделано

- Сверена и актуализирована тема версионных релизов после добавления автоматического release checkout.
- Удалено устаревшее описание fallback на первую доступную машину; зафиксирован единый резолв default target для release-операций.

## Что выяснили (факты, которых не было в KB)

- При пустом `project_machines.path` и заданном `repos_root` релиз использует `<repos_root>/.release_repo`: checkout клонируется идемпотентно, а каталог с чужим `remote.origin.url` не перезаписывается.
- Список веток читается через `git ls-remote` и не требует предварительного клона.

## Куда занесено

- `docs/kb/features/releases.md`

## Открытые вопросы / что осталось

- Нет.

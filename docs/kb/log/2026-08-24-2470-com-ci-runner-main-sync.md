---
title: ci-runner-main-sync
date: 2026-08-24
machine: 2470-com
author: alexeyrozhnov
---

# ci-runner-main-sync

## Что сделано

- Актуализировано описание системной подготовки полного development-рана для существующего checkout.
- Зафиксировано поведение retry-from-step и отказов синхронизации.

## Что выяснили (факты, которых не было в KB)

- Чистый checkout после проверки tracked и untracked изменений синхронизируется через `fetch origin main`, `checkout main`, `reset --hard origin/main`; `git pull` не используется.
- Dirty checkout завершается с exit `66` без удаления файлов, а ошибка status или синхронизации не допускает запуска модели.
- Retry-from-step системную подготовку и синхронизацию не повторяет.

## Куда занесено

- `docs/kb/features/ci-runner.md`, раздел «Стандартный пайплайн проекта».

## Открытые вопросы / что осталось

- Нет.

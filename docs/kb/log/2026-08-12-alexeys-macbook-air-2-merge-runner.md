---
title: merge-runner
date: 2026-08-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# merge-runner

## Что сделано

- Описан отдельный merge-исполнитель и сокращено дублирование в теме development CI.
- Добавлен указатель новой темы и перегенерирован индекс KB.

## Что выяснили (факты, которых не было в KB)

- Merge строится и тестируется в изолированном worktree, а push защищён lease и подтверждением remote SHA.
- Reconcile после начатого push не повторяет изменение main вслепую.
- Текущая реализация при конфликте требует решения пользователя и не запускает LLM-resolver.

## Куда занесено

- `docs/kb/features/merge-runner.md`
- `docs/kb/features/ci-runner.md`
- `AGENTS.md`

## Открытые вопросы / что осталось

- Нет.

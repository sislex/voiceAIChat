---
title: same-commit-topic-freshness-kb
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# same-commit-topic-freshness-kb

## Что сделано

- Сверена реализация свежести тем в `packages/kb-tools/kb.mjs` и тестовые сценарии в `packages/kb-tools/cli.test.mjs` на merge SHA `495279c8`.
- Уточнено описание совместного коммита кода и темы; тема `kb-workflow` обновлена через `touch`.

## Что выяснили (факты, которых не было в KB)

- Из area-коммитов после `checked` по полному SHA исключаются коммиты, затронувшие файл именно проверяемой темы.
- Более поздний code-only коммит остаётся причиной устаревания; изменение другой темы его не скрывает. Touch-only коммит безопасен.

## Куда занесено

- `docs/kb/kb-workflow.md`

## Открытые вопросы / что осталось

- Публикация исправленного пакета и обновление consumer pins остаются операторской задачей.

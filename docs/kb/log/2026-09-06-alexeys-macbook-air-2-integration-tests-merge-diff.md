---
title: integration-tests-merge-diff
date: 2026-09-06
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Integration Tests: merge-aware diff и обязательное покрытие

## Что сделано

- Актуализирована тема о специализированном Integration Tests runner: источник diff, fallback и ранняя блокировка при отсутствии покрытия.

## Что выяснили (факты, которых не было в KB)

- Изменения задачи определяются относительно merge-base с `origin/<ciBaseBranch>`; при ошибке или пустом основном diff используется first-parent diff-tree.
- Пустой результат обоих способов блокирует ран как `diff_parse_failed`, а полностью пустое точное покрытие обязательных automatable-кейсов — как `missing_automation` до кэша и тестовых стадий.

## Куда занесено

- `docs/kb/features/qa-stage-runs.md`

## Открытые вопросы / что осталось

- Нет.

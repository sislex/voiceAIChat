---
title: ci-kb-root-validation
date: 2026-08-04
machine: 2470-com
author: alexeyrozhnov
---

# ci-kb-root-validation

## Что сделано

- KB-шаг теперь проверяет корень клона перед сбором дифа и ходом модели.
- Добавлены регрессии на повторный `SLUG` в `cwd` remote MCP и на явный skipped при недоступном корне.

## Что выяснили (факты, которых не было в KB)

- `CiRunPrimitives.workspacePath` уже содержит `repoPath`, поэтому для KB его нельзя снова дополнять `SLUG`.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

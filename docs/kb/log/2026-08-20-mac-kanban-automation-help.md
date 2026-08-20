---
title: kanban-automation-help
date: 2026-08-20
machine: mac
author: alexeyrozhnov
---

# kanban-automation-help

## Что сделано

- Зафиксирована справка «i» для шести автоматизированных semantic stages канбана.
- Закрыт пробел о жизненном цикле Integration Tests и Automated QA.

## Что выяснили (факты, которых не было в KB)

- Integration Tests хранится в `integration_test_runs`, запускается явно и после повторной проверки gate переводится в `automated_qa`.
- Automated QA хранится в `qa_stage_runs`; переход в `manual_qa` реализован внутренним completion-методом, но runner и публичный completion route отсутствуют.
- Перенос, сортировка и переименование сами эти раны не запускают.

## Куда занесено

- `docs/kb/features/qa-stage-runs.md`

## Открытые вопросы / что осталось

- Runner и публичное завершение Automated QA пока не реализованы.

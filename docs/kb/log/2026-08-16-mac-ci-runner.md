---
title: ci-runner
date: 2026-08-16
machine: mac
author: alexeyrozhnov
---

# ci-runner

## Что сделано

- Дописан разбор repair финального JSON стадии `kb_update`: чего не хватало после
  первого описания механизма.

## Что выяснили (факты, которых не было в KB)

- Repair идёт через `stageRunner` с `allowModelFallback = false`: пустой ответ
  стадийной модели не повторяется на модели рана, третьего хода не бывает.
- Stdout repair-хода в ленту не транслируется (в `ctx.log` уходит только поток
  `system`), наружу идут четыре фиксированные строки стадии.
- Расход repair — вторая строка usage той же стадии `kb_update`, отдельной
  development-операции не появляется.
- `validateKbUpdateJson`: `nothingToUpdate=false` теперь требует минимум один
  документ, одних `topics` недостаточно.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/kb-workflow.md`

## Открытые вопросы / что осталось

- Нет.

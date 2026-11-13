---
title: make-git-compare-kb-gaps
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# make-git-compare-kb-gaps

## Что сделано

- Сверены и закрыты пробелы про Git compare в Make, make-browser и диагностику owner-гейта KB.

## Что выяснили (факты, которых не было в KB)

- Доставку ветки в dev доказывает compare с `origin/dev`, а не upstream status; make-browser выбирает между embedded stand и привязанным Reader; старый повторяющийся разделитель диагностики обрезал список stale-тем.

## Куда занесено

- `docs/kb/server-internals.md`
- `docs/kb/features/make-browser.md`
- `docs/kb/kb-workflow.md`

## Открытые вопросы / что осталось

- Предсуществующие stale-темы из предупреждения этого merge не пересверялись.

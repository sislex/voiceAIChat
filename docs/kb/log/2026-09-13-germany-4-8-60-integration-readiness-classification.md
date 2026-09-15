---
title: integration-readiness-classification
date: 2026-09-13
machine: germany-4-8-60
author: unknown
---

# integration-readiness-classification

## Что сделано

Дополнено описание предметного рана Integration Tests и его DB-покрытия.

## Что выяснили (факты, которых не было в KB)

Отказы предусловий старта сохраняются как инфраструктурные, с первым блокером в `failureReason`; после восстановления readiness создаётся новая queued-попытка.

## Куда занесено

`docs/kb/features/qa-stage-runs.md`.

## Открытые вопросы / что осталось

Нет.

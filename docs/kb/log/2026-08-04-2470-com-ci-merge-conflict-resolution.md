---
title: ci-merge-conflict-resolution
date: 2026-08-04
machine: 2470-com
author: voicechat-ci
---

# ci-merge-conflict-resolution

## Что сделано

- Разрешён merge-конфликт ветки задачи с `origin/main` в статье CI-раннера и
  сгенерированном индексе KB.

## Что выяснили (факты, которых не было в KB)

- Повтор merge-шаг берёт актуальный `origin/$BASE_BRANCH`, поэтому устранение
  конфликта нужно закоммитить в ветке задачи вместе с влитым `origin/main`.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

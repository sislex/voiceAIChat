---
title: ci-runner-move-dequeue
date: 2026-08-07
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-runner-move-dequeue

## Что сделано

- Описана автоматическая отмена ожидающего CI-рана при возврате карточки из разработки в TODO.

## Что выяснили (факты, которых не было в KB)

- Перенос `development` → `backlog` синхронно вызывает `dequeue` для последнего queued-рана; running и awaiting_input блокируют перенос ответом 409.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

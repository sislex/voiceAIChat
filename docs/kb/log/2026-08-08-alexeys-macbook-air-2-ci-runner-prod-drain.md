---
title: ci-runner-prod-drain
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-runner-prod-drain

## Что сделано

- Актуализирована тема очереди CI перед пересборкой production.

## Что выяснили (факты, которых не было в KB)

- Владелец production-пересборки освобождает слот, ждёт снимок незавершённых ранов и удерживает новые раны за процесс-глобальным барьером.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- Нет.

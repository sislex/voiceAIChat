---
title: managed-production-staging
date: 2026-08-23
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# managed-production-staging

## Что сделано

- Дополнена тема релизов поведением managed production/staging и защищённой активацией режима.

## Что выяснили (факты, которых не было в KB)

- Серверный resolver выводит оба изолированных окружения из MachineStorage, повторяет preflight перед deploy и не использует legacy checkout в managed-режиме.

## Куда занесено

- `docs/kb/features/releases.md`

## Открытые вопросы / что осталось

- Нет.

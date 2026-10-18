---
title: system-gate-fetch-retry
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# system-gate-fetch-retry

## Что сделано

- `scripts/system-gate.mjs`: неглубокий fetch owner-репозиториев с GitHub повторяется до 4 раз (5/10/20 с) только при
  транспортных сбоях; между попытками убираются остатки fetch.

## Что выяснили (факты, которых не было в KB)

- Регрессия релиза 0.1.478 упала только на `fatal: fetch-pack: invalid index-pack output` при fetch Core UI, все
  30 системных тестов прошли.

## Куда занесено

- docs/kb/testing-operations.md

## Открытые вопросы / что осталось

-

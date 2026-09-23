---
title: release-hook-timeout
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# release-hook-timeout

## Что сделано

- Для server Vitest задан `hookTimeout: 60_000`, равный уже действующему
  `testTimeout`.
- Повторно запущены четыре набора, упавшие в release gate.

## Что выяснили (факты, которых не было в KB)

- Release gate на восьмиядерной машине дошёл до load average 56 и уронил 11
  несвязанных тестов в четырёх файлах.
- Все падения пришлись на отдельный дефолтный лимит hooks в 10 секунд; лимит
  тестов 60 секунд на `beforeEach`/`afterEach` не распространяется.

## Куда занесено

- `docs/kb/testing-operations.md` — отдельный hook timeout и признаки этого
  инфраструктурного флейка.

## Открытые вопросы / что осталось

- Нет.

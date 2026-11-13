---
title: static-response-compression-kb
date: 2026-10-27
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# static-response-compression-kb

## Что сделано

- Сверены и актуализированы темы о Core static compression, Caddy encode и связанных проверках.
- Закрыты два пробела KB по таймауту delayed-response Universal Search E2E и наследованию concurrency полным гейтом.

## Что выяснили (факты, которых не было в KB)

- Ожидание перехвата delayed-response использует общий `SEARCH_TIMEOUT=10_000`, а не стандартную секунду `vi.waitFor`.
- Планировщик полного гейта принимает `VC_GATE_TEST_CONCURRENCY=1`, но текущий тест default-value наследует переменную и при таком окружении ожидает `3`, поэтому полный suite надо запускать без этой переменной.

## Куда занесено

- `docs/kb/server-internals.md`
- `docs/kb/deploy.md`
- `docs/kb/testing-operations.md`

## Открытые вопросы / что осталось

- Нет.

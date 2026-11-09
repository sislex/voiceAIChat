---
title: sisl880-kb-gaps
date: 2026-11-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl880-kb-gaps

## Что сделано

- Сверены с merge SHA два обязательных пробела SISL-880 и дополнены существующие темы.
- Обновлены метаданные свежести и производный индекс KB.

## Что выяснили (факты, которых не было в KB)

- Для теста доставки Kanban-событий `open` и `claude.active` не являются барьером готовности: публикацию можно начинать после кадра `agents`, а ожидаемые кадры нужно ждать через `vi.waitFor`.
- Kanban-only workflow writers подготовки, QA, merge и autopilot удалены из Core; `QaRepo` пуст, а тестовые writers находятся в `apps/server/src/test/seed.ts`.

## Куда занесено

- `docs/kb/conventions.md`
- `docs/kb/projects.md`

## Открытые вопросы / что осталось

- Нет.

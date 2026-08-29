---
title: restart-reconcile
date: 2026-08-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# restart-reconcile

## Что сделано

- Актуализировано восстановление CI-ранов и релизных попыток после рестарта сервера.

## Что выяснили (факты, которых не было в KB)

- Незапущенный CI-ран повторно ставится в очередь, а его карточка до старта возвращается в исходную колонку; начатый ран получает отдельный статус `interrupted`.
- Release reconcile продолжает `building`/`health_check` через проверку production, но не пытается продолжить неизвестный результат `switching`.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/features/releases.md`

## Открытые вопросы / что осталось

- Нет.

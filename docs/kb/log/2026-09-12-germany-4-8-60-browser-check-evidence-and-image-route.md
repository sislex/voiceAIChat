---
title: browser-check-evidence-and-image-route
date: 2026-09-12
machine: germany-4-8-60
author: unknown
---

# browser-check-evidence-and-image-route

## Что сделано

- Уточнена документация обязательного browser-check стадии `model_work`.
- Зафиксирована синхронная очистка прямого маршрута при закрытии Image Studio.

## Что выяснили (факты, которых не было в KB)

- Доказательством browser-check служат только durable Reader-наблюдения, подписанные областью run/step; отсутствующие в ответе URL и viewport берутся из состояния browser-сессии.
- Закрытие изображения сначала заменяет route, чтобы отложенная синхронизация не открыла его снова.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/ui.md`

## Открытые вопросы / что осталось

- Нет.

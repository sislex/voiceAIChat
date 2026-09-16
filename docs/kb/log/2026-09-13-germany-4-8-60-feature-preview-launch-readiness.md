---
title: feature-preview-launch-readiness
date: 2026-09-13
machine: germany-4-8-60
author: unknown
---

# feature-preview-launch-readiness

## Что сделано

- Уточнено условие готовности кнопки запуска feature-preview и правило её DOM-тестирования.

## Что выяснили (факты, которых не было в KB)

- Кнопка уже существует до завершения `projects:get`, но отключена до выбора допустимой машины; клик в этот момент не отправляет операцию.
- `findByRole` не ожидает доступности элемента, поэтому тест должен отдельно дождаться `toBeEnabled()`.

## Куда занесено

- docs/kb/features/feature-preview.md

## Открытые вопросы / что осталось

- Нет.

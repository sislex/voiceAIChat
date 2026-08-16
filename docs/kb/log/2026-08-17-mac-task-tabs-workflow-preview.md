---
title: task-tabs-workflow-preview
date: 2026-08-17
machine: mac
author: alexeyrozhnov
---

# task-tabs-workflow-preview

## Что сделано

- Актуализирован порядок вкладок карточки задачи по workflow и расположение тестового окружения.

## Что выяснили (факты, которых не было в KB)

- `FeaturePreviewSection` теперь открывает ручной QA перед тест-кейсами и QA-сессией, а не настройки.
- Заявленная доступность GitHub по SSH на MacBook не подтвердилась: обе проверки получили `Permission denied (publickey)`.

## Куда занесено

- `docs/kb/features/ci-runner.md`
- `docs/kb/features/feature-preview.md`

## Открытые вопросы / что осталось

- SSH-доступ не записан как актуальный факт; до успешной проверки действует существующее описание HTTPS-транспорта.

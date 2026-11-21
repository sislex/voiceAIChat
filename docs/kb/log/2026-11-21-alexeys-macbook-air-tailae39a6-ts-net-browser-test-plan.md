---
title: browser-test-plan
date: 2026-11-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# browser-test-plan

## Что сделано

- План ручных браузерных проверок по библиотекам: `docs/test-plan/<библиотека>.json` (14 библиотек, 65 проверок, из них 45 для минимальной сборки sislexa.by).
- Схема и валидатор `TestPlanLibrary` в `packages/shared/src/testPlan.ts`, маршрут только для admin `GET /api/admin/test-plan`, тест проверяет все файлы плана.

## Что выяснили (факты, которых не было в KB)

- Минимальная сборка определяется по отсутствию Make в манифесте развёртывания: маршрут отдаёт `defaultBuild: minimal`.

## Куда занесено

- docs/kb/testing-operations.md

## Открытые вопросы / что осталось

- Страница `#/test-plan` в Core UI; отметка результатов прогона в плане пока не хранится.

---
title: Назначение Web Reader и Playwright Reader
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Назначение Web Reader и Playwright Reader

## Что сделано

- Сверены назначение двух Reader-режимов и исполнение команд модели; исправлены устаревшие ограничения в тематической статье. Код приложений не менялся.

## Что выяснили (факты, которых не было в KB)

- В сравнении режимов не было указано, что Web Reader также записывает сценарии и экспортирует их в Playwright (`apps/web-recorder/src/Recorder.tsx`).
- Старые разделы ошибочно отмечали инструменты модели, `evaluate`, `hover` и перетаскивание как недоступные в Chromium; текущую поддержку подтверждают `apps/playwright-reader/src/module.ts` и `packages/shared/src/browserActions.ts`.

## Куда занесено

- docs/kb/features/playwright-reader.md — сравнение режимов и исправление прежних ограничений.

## Открытые вопросы / что осталось

- Живые сервисы и браузерные сессии не проверялись; ответ описывает возможности текущего кода.

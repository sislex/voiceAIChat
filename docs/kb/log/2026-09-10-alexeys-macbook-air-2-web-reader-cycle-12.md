---
title: web-reader-cycle-12
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-cycle-12

## Что сделано

Десять исправлений cookies перечислены в плане. Стандартный CookieJar заменяет
ручной разбор; контейнер принадлежит модулю Reader и общий для HTTP/MCP reset.
Промежуточный redirect устанавливает сессию до следующего запроса.

## Что выяснили

Старый разбор смешивал host-only с Domain, /app с /apple и неверно учитывал expiry.
После выделения экземпляра MCP тоже должен использовать его: иначе сброс модели
молча очищает уже не используемую глобальную коллекцию.

## Куда занесено

- docs/kb/server-internals.md
- docs/plans/web-reader-20-cycles.md

## Проверки

34 unit/integration 04:42:50–04:42:52 и typecheck — код 0.
11 Chromium 04:42:52–04:43:05 — код 0, включая вход в настоящее приложение.
Fast 341,198 с и полный gate 390,257 с — оба код 0.
Полные временные окна находятся в плане.

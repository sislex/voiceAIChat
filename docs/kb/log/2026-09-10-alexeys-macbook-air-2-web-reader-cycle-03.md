---
title: web-reader-cycle-03
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-cycle-03

## Что сделано

Исправлен подтверждённый отказ логина внутри Reader (приоритет узкой Strict
preview-cookie), изолирован и ограничен кэш ресурсов машины. Десять пунктов
и время — docs/plans/web-reader-20-cycles.md.

## Проверки

48 адресных unit, 10 Chromium-тестов кэша и полный браузерный вход в собственное
приложение прошли. После добавлен ещё HTTP-тест регистра Cache-Control; он
входит в гейт (49 адресных тестов). Снимок страницы машин просмотрен.
`gate:fast` и `gate` завершились кодом 0; проверено 02:21:02 +03:00.

## Куда занесено

- docs/kb/data-auth.md — приоритет и область preview-cookie.
- docs/kb/server-internals.md — политика и жизненный цикл кэша Reader.

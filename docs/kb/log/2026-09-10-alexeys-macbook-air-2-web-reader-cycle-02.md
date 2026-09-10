---
title: web-reader-cycle-02
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-cycle-02

## Что сделано

Десять исправлений ESM и ресурсов: AST вместо regexp, публичные JS-ответы,
явные import map и `new URL` относительно адреса исходного модуля. Полный список
и время — docs/plans/web-reader-20-cycles.md.

## Проверки

38/38 адресных unit, 20/20 Chromium двух циклов, typecheck server — код 0.
`gate:fast` и `gate` — код 0, завершение проверено 02:04:27 +03:00.
При отдельной проверке настоящего приложения воспроизведён исходный отказ логина
с `csrf` на прокси; исправление запланировано в следующем цикле и не объявляется
готовым в этом коммите.

## Куда занесено

- docs/kb/server-internals.md — раздел «Прокси веб-превью».

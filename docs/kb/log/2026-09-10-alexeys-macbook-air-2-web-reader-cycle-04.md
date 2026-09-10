---
title: web-reader-cycle-04
date: 2026-09-10
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-cycle-04

## Что сделано

Десять исправлений навигации: конечный URL redirect, deep link без лишнего шага
истории, hash в pushState, hash в replaceState, актуальный pageInfo, уведомления
SPA, адрес/draft без перезагрузки, сохранение разговора без эхо-перезагрузки,
BFCache и восстановление четырёх режимов. 87 адресных unit/DOM и 11 Chromium зелёные.

## Что выяснили

Смена URL разговора после навигации раньше повторно очищала iframe через cookie-гейт.
Скриншот настоящего App после перехода из машин в чат просмотрен; performance.timeOrigin
подтверждает сохранение документа. Нативный history.replaceState нужен до шима,
чтобы канонизация redirect/hash не добавляла запись истории.

## Куда занесено

- docs/kb/server-internals.md
- docs/kb/ui.md
- docs/plans/web-reader-20-cycles.md

## Проверки

Подключение и адресные проверки: 02:21:40–02:23; `gate:fast` и полный `gate` завершились кодом 0, завершение проверено в 02:31:59.

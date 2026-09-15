---
title: web-reader-user-like-cycle-07
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-07

## Что сделано

- Цикл 07 серии «Web Reader: браузер как у пользователя»: инструмент `show` (модель показывает элемент пользователю
  подписью), `screenshot {marks}` с нумерованными рамками, `read {brief}` и чтение открытого модального окна,
  `dialogs` после `press`, `wait {idle}` в панели и Chromium, `element` у `scroll`, `status.manual` через сообщение
  `control`, рассказ relay в `reader.changed.summary`; в панели — ✋ ручного режима во вкладках телефона,
  «Показать» через `show`, paste-and-go, «Поделиться…», тёмный фон iframe, скрытая «Открыть» до 360 px.
- Гейт модуля зелёный по коду возврата (shared, web-reader-contracts, web-reader, web-recorder, web-reader-app,
  browser-runner, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- Снимок с `marks` нельзя проверить в jsdom (нет canvas): список номеров собирается до `captureArea`, а отрисовка
  рамок живёт только в браузере — проверять вживую в Chrome.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 07.

## Открытые вопросы / что осталось

- Циклы 08–20.

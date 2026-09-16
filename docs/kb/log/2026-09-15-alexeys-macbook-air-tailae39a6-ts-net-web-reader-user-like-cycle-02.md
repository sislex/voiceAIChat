---
title: web-reader-user-like-cycle-02
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-02

## Что сделано

- Цикл 02 серии «Web Reader: браузер как у пользователя» (`docs/plans/web-reader-user-like-browsing-20-cycles.md`):
  относительный `open`, `read {visible}`, `back/forward` с новой страницей, `placeholder`/`value` элементов,
  `dialogs`/`focus`/`newErrors` у клика, `tooltip` у hover, подсветка элемента на странице, инструктивные ошибки
  relay/host; на телефоне — живая строка действия и заголовок страницы во вкладке «Сайт», точка «Чат» при ответе,
  свёрнутая лента и время шагов, подсказка пустого состояния, `enterKeyHint`, подсветка разделителя.
- Гейт модуля: shared 1085, web-reader 430, web-recorder 175, web-reader-app 101, ui (`readerSplitControls`,
  `App.dom`) 80 — зелёные; typecheck затронутых пакетов зелёный.
- Chrome: живой ход Codex прочитал example.com, нажал «Learn more», панель перешла на IANA; мобильная раскладка
  проверена через iframe 390 px внутри страницы приложения (`resize_window` расширения не меняет innerWidth).

## Что выяснили (факты, которых не было в KB)

- Мобильную раскладку в Chrome-расширении удобнее проверять same-origin iframe 390 px, добавленным в документ
  приложения: медиазапросы срабатывают по ширине iframe.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 02.

## Открытые вопросы / что осталось

- Циклы 03–20.

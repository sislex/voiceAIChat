---
title: web-reader-user-like-cycle-18
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-18

## Что сделано

- Цикл 18 серии «Web Reader: браузер как у пользователя». Модель: `read {next|toc|table,rowOffset}`,
  `read.lists`, `find {in}`, `scroll {until, maxScreens}`, закладки сеанса `bookmark` с выдачей в
  `status.bookmarks` и `report.bookmarks`, подписи и фразы ленты для всего этого.
- UI: ряд закладок и «Запомнить страницу» в панели, ящик «Оглавление (N)» с переходом к разделу и Escape,
  поле «Листать до…», «осталось ~N мин» и озвучка полосы чтения, Alt+End, «Копировать текст страницы».
- Гейт модуля зелёный по коду возврата: typecheck и тесты shared, web-reader, web-reader-app, web-recorder,
  web-reader-contracts, typecheck ui.

## Что выяснили (факты, которых не было в KB)

- `sectionScope` отдаёт **клон** раздела (для чтения), поэтому спрашивать у него про живые элементы
  страницы нельзя: для `find {in}` понадобился отдельный `sectionRange`, собирающий настоящие узлы.
- Закладки — состояние разговора, а не страницы, поэтому они живут в мосте панели: страница о них не знает,
  а человек и модель видят один список.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью (mcp__browser__*)» и «Независимый Веб-рекордер и контракт хоста».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 18.

## Открытые вопросы / что осталось

- Циклы 19–20.

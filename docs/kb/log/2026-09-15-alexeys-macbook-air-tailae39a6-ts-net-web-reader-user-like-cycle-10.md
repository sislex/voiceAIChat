---
title: web-reader-user-like-cycle-10
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-10

## Что сделано

- Цикл 10 серии «Web Reader: браузер как у пользователя»: таблицы в `read`, `find {href}` и порядок «видимое
  первым», `hover {waitMs}`, `errors {kinds}`, `check {url|title}`, русские названия клавиш, гало подсветки;
  в панели — «×N» для повторов, «✓ N · ✗ M», короткие адреса в ленте, язык страницы, пресеты 360/1280,
  вращающаяся «Обновить», подсказки клавиш, точка активного режима, запомненная вкладка телефона.
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- Порядок «видимое на экране первым» в jsdom не проверить: у всех элементов нулевые rect — проверка только в Chrome.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 10.

## Открытые вопросы / что осталось

- Циклы 11–20.

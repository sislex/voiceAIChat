---
title: web-reader-user-like-cycle-04
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-04

## Что сделано

- Цикл 04 серии «Web Reader: браузер как у пользователя»: инструменты `fill` и `choose`, `options`/`validation` у ввода,
  `revealed` у hover, `focus` у read, `wait` по состоянию контрола в панели, hash-навигация без перезагрузки,
  режим «Только я управляю», сворачивание чата на десктопе, отключённая на время загрузки кнопка «Обновить», Cmd/Ctrl+Enter во внешнюю
  вкладку, host в статусе загрузки, скрываемая ошибка страницы, очистка недавних, 44 px цели.
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- `<input list=…>` меняет ARIA-роль поля на `combobox` и ломает 22 запроса `getByRole('textbox')` в unit и E2E —
  datalist недавних адресов отвергнут, недавние остаются чипами и пунктами меню.
- jsdom не считает `minlength` нарушением для программно установленного значения (поле не «грязное»): валидацию
  в тестах проверяют через пустое обязательное поле.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 04.

## Открытые вопросы / что осталось

- Циклы 05–20.

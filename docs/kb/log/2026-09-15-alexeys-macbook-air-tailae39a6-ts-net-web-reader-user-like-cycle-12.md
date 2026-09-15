---
title: web-reader-user-like-cycle-12
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-12

## Что сделано

- Цикл 12 серии «Web Reader: браузер как у пользователя»: `enabled`/`checked` у find и check, `role` у click/hover,
  `notices` и `progress` в read, `brief` с уведомлениями, `fill {perKey}`, `sequence {continueOnError}`;
  в панели — поиск по странице (Ctrl/Cmd+F), Alt+Shift+M, drag-and-drop адреса, копирование ошибок,
  имя пресета в чипе, «Показать» по тексту, «только что», tooltip вкладки «Сайт».
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- `window.find` доступен у same-origin iframe панели: поиск по сайту не требует инъекции в страницу.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 12.

## Открытые вопросы / что осталось

- Циклы 13–20.

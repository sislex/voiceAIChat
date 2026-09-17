---
title: web-reader-user-like-cycle-05
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-05

## Что сделано

- Цикл 05 серии «Web Reader: браузер как у пользователя»: нормализация кавычек/тире в поиске текста,
  `read {section}`, `selection` пользователя в `read`, `find {onScreen}`, `type {perKey}`, `obscuredBy` у клика,
  `wait {url}` мостом панели, `history` в `status`, сообщение `ask` (выделение → вопрос в чате); в панели —
  чип «Спросить ассистента», строка неудачи действия с «Повторить», секунды долгого действия, группы и клавиатурная
  навигация меню инструментов, «Копировать ссылку с названием», `aria-keyshortcuts`, подсказка про полный браузер,
  янтарный индикатор в ручном режиме, «Открыть текущий проект» в пустом состоянии.
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- Внутри template literal инъецируемого скрипта обратная кавычка в regex обязана быть ```: иначе она закрывает
  строку и typecheck падает на «Invalid character».

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 05.

## Открытые вопросы / что осталось

- Циклы 06–20.

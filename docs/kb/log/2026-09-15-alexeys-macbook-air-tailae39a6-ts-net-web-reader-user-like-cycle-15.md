---
title: web-reader-user-like-cycle-15
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-15

## Что сделано

- Цикл 15 серии «Web Reader: браузер как у пользователя»: `read {around|markdown}`, selector у заголовков,
  `find {level}`, `type {blur}`, `scroll {percent}`, `fill secret`, `outline.words`, `status.outline`, список
  пунктов в ошибке `choose`; в панели — полоска прочитанного, время чтения, масштаб текста, Shift+«Обновить»,
  стрелки в подсказках адресов, фокус на «Разрешить», дата в tooltip и «Открыть страницу» в ленте.
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- `body.style.zoom` у same-origin страницы масштабирует сайт без перезагрузки; значение хранится в ref панели и
  применяется заново на каждом `page-ready`.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 15.

## Открытые вопросы / что осталось

- Циклы 16–20.

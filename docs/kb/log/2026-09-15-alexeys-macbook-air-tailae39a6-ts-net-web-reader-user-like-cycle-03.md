---
title: web-reader-user-like-cycle-03
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-03

## Что сделано

- Цикл 03 серии «Web Reader: браузер как у пользователя» (`docs/plans/web-reader-user-like-browsing-20-cycles.md`):
  `near`/`exact`/`context` для различения одинаковых элементов, инструмент `status`, `outline` в ответе `open`,
  `forms` и `landmarks` в `read`, `atTop`/`atBottom` у `scroll`; в панели — индикатор связи с чатом, значок схемы,
  недавние адреса в меню, «Показать» в ленте действий, внешняя вкладка при ошибке загрузки, скрытая строка файла
  сценария, объявление страницы скринридеру, перенос шапки на телефоне.
- Гейт модуля: shared, web-reader, web-recorder, web-reader-app, целевые тесты ui — зелёные по коду возврата;
  typecheck затронутых пакетов зелёный.

## Что выяснили (факты, которых не было в KB)

- `role="status"` на постоянно видимых элементах Recorder ломает существующие тесты `getByRole('status')`:
  индикатор связи сделан `role="img"`, а объявление страницы рендерится только при готовой странице.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 03.

## Открытые вопросы / что осталось

- Циклы 04–20.

---
title: web-reader-user-like-cycle-16
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-16

## Что сделано

- Цикл 16 серии «Web Reader: браузер как у пользователя». Модель: `find`/`click {below|above|leftOf|rightOf}`
  (место вместо селектора), `find {details}`, `click {peek}` (куда ведёт ссылка, без нажатия),
  `dismiss {cookies|dialog|any}`, `read.overlays`, `read {parts: [images]}` и `read.images`, `scroll.percent`,
  фразы ленты для peek и dismiss, `no-store` для переписанного HTML.
- Панель: строка состояния со ссылкой, меню ссылки по долгому нажатию, свайп от края назад/вперёд, режим
  чтения, шпаргалка клавиш, история вкладки по удержанию «Назад», масштаб по сайту, host вместо адреса на
  телефоне, автоскрытие тулбара при чтении вниз и кнопка «К началу страницы».
- Гейт модуля зелёный по коду возврата: typecheck и тесты shared, web-reader, web-reader-app, web-recorder,
  web-reader-contracts; сборки рекордера и панели.
- Проверено в Chrome на живом стенде (desktop и 390 px через same-origin iframe): строка состояния показывает
  `http://www.iana.org/protocols` при наведении, `dismiss` и новые каналы есть в отданном прокси скрипте.

## Что выяснили (факты, которых не было в KB)

- Переписанный прокси HTML раньше отдавался с `cache-control` исходного сайта, поэтому iframe панели держал
  прошлую версию инъецированного скрипта после релиза: живая страница не знала про новые каналы, пока её не
  перезагрузили принудительно. Теперь документы всегда `private, no-store`, ресурсы свой заголовок сохраняют.
- jsdom не считает раскладку: тесты сторон и оверлеев подменяют `Element.prototype.getBoundingClientRect`
  значениями из `data-rect="x,y,w,h"`, а у iframe в jsdom нет `document.scrollingElement` — прокрутку страницы
  тестируем, подставляя его объектом с `scrollTop`/`scrollHeight`.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью (mcp__browser__*)» и «Независимый Веб-рекордер и контракт хоста».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 16.

## Открытые вопросы / что осталось

- Циклы 17–20.
- Живой UI изредка показывает экран входа при рабочем `/api/session/me` (вероятно вытеснение сессии по
  `sessions.maxPerUser`) — вне модуля, свежая вкладка работает.

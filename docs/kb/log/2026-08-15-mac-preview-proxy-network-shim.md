---
title: preview-proxy-network-shim
date: 2026-08-15
machine: mac
author: alexeyrozhnov
---

# preview-proxy-network-shim

## Что сделано

- Превью-прокси перехватывает динамический трафик страницы: context shim
  (`previewContextScript`) переопределяет `window.fetch`,
  `XMLHttpRequest.prototype.open/setRequestHeader`, `navigator.sendBeacon` и
  `history.pushState/replaceState`, заворачивая http/https-URL в `/api/preview?url=`.
- Роут `/api/preview` вынесен в собственный fastify-scope с
  `removeAllContentTypeParsers()` и catch-all `'*'`-парсером: тело любого
  content-type уходит апстриму сырым буфером, ограничение на
  `application/x-www-form-urlencoded` снято.
- Заголовки входящего запроса фильтрует `upstreamRequestHeaders()`; `url()`
  переписывается и в `<style>`-блоках HTML, и в inline `style=""`.

## Что выяснили (факты, которых не было в KB)

- `Authorization` самой превьюшной страницы шим переименовывает в
  `x-preview-authorization`, иначе Bearer-гейт ChatAI принял бы токен внешнего
  сайта за свой и ответил 401; роут возвращает заголовок апстриму как
  `authorization`, а cookie/`authorization` ChatAI наружу не уходят.
- Присваивание `window.location.href` в браузере перехватить нельзя: интерфейс
  `Location` целиком `[LegacyUnforgeable]`, `Object.defineProperty` на
  `href`/`assign`/`replace` падает. Шим пробует в `try/catch` (срабатывает в
  jsdom-тестах), реальную SPA-навигацию держат History API и серверное
  переписывание `href`/`action`.
- SSRF-проверка (`assertPublicHost` + кастомный DNS-lookup) живёт в `get()`,
  поэтому действует на каждый проксируемый запрос и каждый redirect-хоп, включая
  переписанные fetch/XHR/beacon.

## Куда занесено

- docs/kb/server-internals.md — раздел «Прокси веб-превью»
- docs/kb/ui.md — раздел «Веб-превью»
- статья проекта «Веб-превью и авторизация iframe»

## Открытые вопросы / что осталось

- Прямое присваивание `location.href` со стороны страницы уводит iframe на origin
  ChatAI — покрытия для этого случая в шиме нет by design.

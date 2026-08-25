---
title: web-reader-instagram-limits
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-instagram-limits

## Что сделано

- Живой эксперимент «Instagram через Web Reader»: транспорт работает
  (/api/preview отдаёт 200, ~450 КБ, инъекции на месте), сплэш-скрин IG
  рендерится, статика и бандлы загружаются, но SPA не поднимается — форма
  логина не появляется. Вход не выполнялся (и по правилам ассистент не вводит
  пароли; в рабочем сценарии логин вводит пользователь сам в превью).

## Что выяснили (факты, которых не было в KB)

- SPA с history-роутером (маршрут из location.pathname) через прокси не
  работают: документ живёт на /api/preview?url=…, роутер IG не матчит маршрут
  и остаётся на сплэше; pathname подделать нельзя (Location [LegacyUnforgeable]).
  Диагноз подтверждён: requireLazy/splash-screen/mount есть, body пуст.
- Динамические <script src> лоадеров уходят мимо шима напрямую на CDN
  (static.cdninstagram.com): загружаются, но не проксируются.
- postMessage-мост инъецированного скрипта отвечает только parent (Reader) —
  из top-окна команды не работают (защита источника действует).

## Куда занесено

- docs/kb/server-internals.md — «Прокси веб-превью», абзац «Границы прокси-подхода».

## Открытые вопросы / что осталось

- Полноценные чужие SPA (Instagram и т.п.) — ниша playwright-reader.

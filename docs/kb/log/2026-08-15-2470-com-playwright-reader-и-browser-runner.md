---
title: Playwright Reader и browser-runner — первый срез
date: 2026-08-15
machine: 2470-com
author: alexeyrozhnov
---

# Playwright Reader и browser-runner — первый срез

## Что сделано

- Занесена в KB новая функция: тип разговора `playwright-reader`, маршрут
  `#/playwright-reader[/:id]`, отдельный список чатов в сторе и новый workspace
  `apps/browser-runner`.

## Что выяснили (факты, которых не было в KB)

- Сквозного режима нет: browser-runner ни откуда не вызывается (в `apps/server` и
  `packages/ui` нет ни одного упоминания), правая панель — статичная заглушка,
  MCP/screencast/оркестрации сессий нет.
- `isReaderConversation` сужен: легаси-ветка по `previewUrl` работает только при
  пустом `assistantKind`, поэтому списки двух ридеров не пересекаются.
- Нумерация новых reader-чатов сменилась с «максимум + 1» на первый свободный
  номер — общая для обоих видов.
- Playwright-чаты пока видны в обычном списке сайдбара: его фильтр отсекает только
  `web-recorder` и чаты с `previewUrl`.
- Раннер не знает пользователей ChatAI: только непрозрачные `userKey`/`conversationKey`,
  профиль — sha256-хеш пары, сетевая политика fail-closed на `context.route`.

## Куда занесено

- `docs/kb/features/playwright-reader.md` (новая тема), `docs/kb/ui.md`
  (раздел «Отдельный режим Playwright Reader» + уточнение `isReaderConversation`),
  `apps/browser-runner/AGENTS.md` + `CLAUDE.md`, таблицы указателей в корневом `AGENTS.md`.

## Открытые вопросы / что осталось

- `npm install` после появления воркспейса: `playwright` в lock есть, в
  `node_modules` рабочей копии нет — typecheck пакета падает без него.
- Формат скриншота: контракт допускает webp, раннер отдаёт байты всегда с
  `image/png`.

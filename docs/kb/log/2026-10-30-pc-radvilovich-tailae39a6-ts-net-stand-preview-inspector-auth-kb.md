---
title: stand-preview-inspector-auth-kb
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# stand-preview-inspector-auth-kb

## Что сделано

- Сверена авторизация загрузки preview-inspector с текущим кодом Core и stand proxy.
- После сверки на merge SHA обновлена свежесть темы `server-internals`.

## Что выяснили (факты, которых не было в KB)

- `StandProxy` передаёт cookie уже аутентифицированного lease-запроса вместе с сохранённым `parentOrigin` в `previewInspectorScript`.
- Core прокидывает cookie во внутренний `app.inject` к защищённому маршруту `/api/preview/inspector.js`; исключения и non-2xx превращаются в пустой HTTP 502.

## Куда занесено

- `docs/kb/server-internals.md`, раздел `Dev stand access proxy`.

## Открытые вопросы / что осталось

- Нет.

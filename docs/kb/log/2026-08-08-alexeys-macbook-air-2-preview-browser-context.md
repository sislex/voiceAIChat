---
title: preview-browser-context
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# preview-browser-context

## Что сделано

- В веб-превью появился полноценный серверный cookie-контекст и изоляция browser storage внешних сайтов; HTTP-формы теперь проходят через `/api/preview`.

## Что выяснили (факты, которых не было в KB)

- Внешний `Set-Cookie` не передаётся iframe: `apps/server/src/routes/previewProxy.ts` сохраняет его по пользователю и добавляет в исходящий запрос только после проверки domain, path, secure и срока действия.
- Context shim в HTML префиксирует ключи `localStorage` и `sessionStorage`, а также имена баз `indexedDB` origin'ом внешнего сайта. Это изолирует сайты, которые рендерятся под одним origin ChatAI.

## Куда занесено

- docs/kb/ui.md, раздел «Веб-рекордер» — дополнено описание cookie-контекста, изоляции storage и отправки form POST через прокси.
- Статья раздела «Разработка проекта» «Веб-превью и авторизация iframe» (id `5dd21532-c819-4237-84c7-84c0008a1624`) — требует того же обновления через серверную БЗ.

## Открытые вопросы / что осталось

- Нет.

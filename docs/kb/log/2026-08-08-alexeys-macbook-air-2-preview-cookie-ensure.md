---
title: preview-cookie-ensure
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# preview-cookie-ensure

## Что сделано

- CHAT-139: авторизованный пользователь получал 401 в веб-превью для любых сайтов
  (в т.ч. https://www.onliner.by/), если preview-cookie ставилась только при
  `POST /api/session/login`. Добавлен `POST /api/session/preview`
  (`apps/server/src/users/auth.ts`), переиздающий `vc_preview_session` из
  действующего Bearer-токена без пароля; путь публичный (`/api/session/*`),
  Bearer проверяет сам. Web-мост получил `session.ensurePreview()`
  (`packages/ui/src/remote/index.ts`, тип — `RendererSessionBridge.ensurePreview?`
  в `packages/shared/src/ipc.ts`), `PreviewPane` (`packages/ui/src/App.tsx`) не
  монтирует iframe, пока cookie не подтверждена (статусы «Подключение
  превью…» / «войдите заново» с ретраем через «Обновить»); desktop без моста —
  гейт открыт сразу.

## Что выяснили (факты, которых не было в KB)

- Cookie `vc_preview_session` — session-cookie (без `Max-Age`), поэтому не
  переживает перезапуск браузера; а сессия, восстановленная из `localStorage`
  через `me()` без повторного login, вообще никогда её не получала. Оба случая
  оставляли iframe `/api/preview` без credentials → 401 для любого сайта, не
  только внешнего — баг не был specific к прокси или к onliner.by.

## Куда занесено

- docs/kb/ui.md (раздел «Сплит чата с веб-превью», абзац про iframe/cookie) —
  уже отражал `POST /api/session/preview` и гейт `PreviewPane` из самого дифа
  задачи, доп. правок не требовалось.
- docs/kb/server-internals.md (раздел «Прокси веб-превью») — добавлен абзац про
  авторизацию `/api/preview` через cookie и про `POST /api/session/preview`;
  закрывает пробел «docs/kb/server-internals.md#прокси-веб-превью» и общий
  пробел по `docs/kb/server-internals.md`.
- Статья раздела «Разработка проекта» «Веб-превью и авторизация iframe»
  (id 5dd21532-c819-4237-84c7-84c0008a1624) — обновлена тем же фактом.

## Открытые вопросы / что осталось

-

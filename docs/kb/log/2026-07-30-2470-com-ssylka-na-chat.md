---
title: ссылка-на-чат
date: 2026-07-30
machine: 2470-com
author: alexeyrozhnov
---

# ссылка-на-чат

## Что сделано

- У открытого разговора появился адрес `#/chat/:id`: клик по чату в сайдбаре,
  «+ Новый», удаление активного, `openTaskChat` и resume сессии Claude/Codex
  теперь ведут через URL, а не только через стор.
- `App.tsx`: одна точка синхронизации `syncedChatId` (маршрут ↔ `activeId`) —
  адрес изменился, грузим чат; стор сменил чат сам, переписываем адрес `replace`-ом.
- `useHashRoute.navigate(to, { replace: true })` через `history.replaceState`
  плюс собственный список подписчиков (replaceState не даёт `hashchange`).
- `init(preferredChatId)` → `bootstrap()` открывает чат из адреса вместо самого
  свежего; `selectConversation` возвращает `boolean` и переключает фильтр
  сайдбара, если чат из ссылки в другом проекте; `newConversation`/`openTaskChat`/
  `resumeCcSession`/`resumeCxSession` возвращают id разговора.
- Тесты: `App.chat.dom.test.tsx` (7 кейсов), плюс кейсы в `voiceStore.test.ts` и
  `voiceStore.projects.test.ts`.

- Попутно: `npm run typecheck` был красным ещё до правки — `@voicechat/web`
  не знал про `window.ci` (мост появился с CI-раннером). Тип `RendererCiBridge`
  теперь экспортируется из `@voicechat/ui`, а `apps/web/src/global.d.ts` его
  объявляет; общий typecheck снова зелёный.

## Что выяснили (факты, которых не было в KB)

- jsdom держит один `window.location` на файл тестов: раз App пишет в hash,
  маршрут протекает в соседние кейсы (падали ассерты на «неактивный» чат в
  `App.dom.test.tsx`). Сброс вынесен в общий `src/test/setup.ts`, с `try/catch` —
  `remote.test.ts` подменяет `window.location` своим объектом.
- До этой правки resume сессии CLI оставлял пустую колонку: `ccOpen/cxOpen`
  сбрасывались, а маршрут `#/claude-code` оставался, и эффект `utilitySeg` не
  перезапускался. Теперь resume уводит на `#/chat/:id`.

## Куда занесено

- docs/kb/ui.md — раздел «Маршруты (hash-роутер)».

## Открытые вопросы / что осталось

- Строка чата в сайдбаре осталась `div` (внутри — кнопки переименования/удаления,
  вложенные интерактивные элементы в `<a>` невалидны), поэтому «скопировать
  ссылку» правым кликом по строке не работает — адрес берётся из строки браузера.

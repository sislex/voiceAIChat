---
title: Web Reader — независимый список чатов и детерминированное создание
date: 2026-08-15
machine: mac
author: alexeyrozhnov
---

# Web Reader — независимый список чатов и детерминированное создание

## Что сделано

- Описано новое поведение экрана Web Reader (CHAT-230, коммит 9d070e0): список
  чатов, создание нового чата и селектор `web-recorder-selector`.

## Что выяснили (факты, которых не было в KB)

- Список чатов Web Reader — отдельное состояние стора `state.readerConversations`
  из полного ответа `conversations:list`, до фильтра `sidebarProjectId`; предикат
  `isReaderConversation` (`assistantKind === 'web-recorder'` или сохранённый
  `previewUrl`) экспортирован из `packages/ui/src/store/voiceStore.ts`.
- При активном поиске сайдбара (`conversations:search`) reader-список не
  пересчитывается; удаление чата и `setConversationPreviewUrl` правят его напрямую.
- `selectConversation` держит токен актуальности: устаревший ответ
  `conversations:get` отбрасывается молча, вызов возвращает `false` и не снимает
  `loadingMessages` (флагом владеет более поздний вызов; `newConversation` сбрасывает
  его сам).
- Создание reader-чата в `App.tsx` идёт через общий `createReaderChat` с in-flight
  ref: пока создание в полёте, эффект авто-выбора не трогает `activeId` и не создаёт
  второй чат. Имя нового чата — «Web Reader N» (максимум по существующим +1).
- Селектор при `activeId` вне списка показывает disabled-плейсхолдер «Чат не
  выбран» вместо молчаливой подсветки первого пункта.

## Куда занесено

- docs/kb/ui.md — разделы «Отдельный режим Web Reader» и «Web Reader — отдельная
  страница»
- Статья сервисной БЗ «Сплит чата с веб-превью: проектный адрес и override
  разговора»

## Открытые вопросы / что осталось

- Нет.

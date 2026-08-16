---
title: playwright-reader-preview-binding
date: 2026-08-16
machine: mac
author: alexeyrozhnov
---

# playwright-reader-preview-binding

## Что сделано

- Актуализировал описание правой панели Playwright Reader: вместо статичной
  заглушки маршрут монтирует общий `WebReaderHost`, поэтому `mcp__browser__*`
  работают и в этом режиме.
- Описал единый источник истины о привязке панели к чату: `previewRunnerRef`
  хранит пару `{ conversationId, runner }`, а проверка в `AppBody` требует
  совпадения активного чата, Reader-маршрута и чата регистрации.

## Что выяснили (факты, которых не было в KB)

- Восстановление после refresh держится на `initialChatId`: `useVoiceStore`
  получает `routeChatId ?? routeReaderChatId ?? routePlaywrightReaderChatId`,
  поэтому чат из `#/playwright-reader/<id>` активен сразу и панель
  привязывается без действий пользователя.
- Снятие регистрации обнуляет ссылку только для текущего чата — иначе
  размонтирование старого host-а стирало бы регистрацию уже переключённого.
- В Playwright-режиме в `WebReaderHost` передаётся только `conversationUrl`
  (`projectUrl` — `null`), а секция и iframe сохраняют подпись «Web Reader»:
  DOM-селекторы ищут панель по этому имени и на маршруте Playwright Reader.
- Диагностика различима на трёх уровнях: «не открыт на странице Reader»,
  «панель активного чата не открыта или ещё не подключена» и тексты самого
  host-а про неготовую страницу.
- CSS-правила заглушки `.playwright-browser-pane` и `.playwright-reader-header`
  остались в `app.css` мёртвыми (живёт только `.playwright-reader-selector`).

## Куда занесено

- docs/kb/features/playwright-reader.md — «Что реализовано, а что нет»
  (механика привязки) и «Маршрут и UI».
- docs/kb/ui.md — «Отдельный режим Playwright Reader» и «Действия модели в
  превью (mcp__browser__*)».

## Открытые вопросы / что осталось

- Интеграции панели с `apps/browser-runner` по-прежнему нет: screencast, ввод в
  Chromium, оркестрация сессий и метрики не реализованы.

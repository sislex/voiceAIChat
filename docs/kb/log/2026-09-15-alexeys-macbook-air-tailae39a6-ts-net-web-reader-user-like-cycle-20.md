---
title: web-reader-user-like-cycle-20
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-20

## Что сделано

- Круг 20 (последний) серии «Web Reader: браузер как у пользователя». Модель: `note` оставляет человеку
  заметку в панели, `report {readable: true}` отдаёт готовый текст отчёта с длительностью сеанса,
  `status.actions` и `status.since` показывают размер сеанса, инструмент MCP `note`.
- UI: заметки ассистента с адресом страницы и копированием, «Скопировать отчёт» и блок «Текст отчёта»,
  «Отчёт в чат» отправляет тот же текст, лента действий разбита по страницам.
- Гейт модуля зелёный по коду возврата: typecheck и тесты shared, web-reader, web-reader-app, web-recorder,
  web-reader-contracts, ui.

## Что выяснили (факты, которых не было в KB)

- Булев флаг нельзя называть именем, которое в других вариантах union-а уже строка: `report {text: boolean}`
  сделал `PreviewAction` неприсваиваемым в `pendingActionLabel` (`packages/ui/src/readerSplitControls.ts`) и
  сломал сужение `'text' in result` в диагностике. Флаг переименован в `readable`.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью (mcp__browser__*)» и «Независимый Веб-рекордер и контракт хоста».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 20 и итог серии.

## Открытые вопросы / что осталось

- Серия из двадцати кругов закрыта.
- Живой UI изредка показывает экран входа при рабочем `/api/session/me` (вероятно вытеснение сессии по
  `sessions.maxPerUser`) — вне модуля.

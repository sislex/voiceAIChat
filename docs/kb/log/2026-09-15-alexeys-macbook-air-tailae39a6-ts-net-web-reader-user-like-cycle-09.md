---
title: web-reader-user-like-cycle-09
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-09

## Что сделано

- Цикл 09 серии «Web Reader: браузер как у пользователя»: инструмент `sequence` (до 10 шагов одним вызовом с
  прогрессом), `read {parts}`, `check {contains}`, `scroll {to: nextPage|prevPage}`, `click {x, y}`,
  `back/forward {steps}`, `network {since}`, `status.pending`, рассказ relay о последовательности; в панели —
  шаг последовательности в живой строке, JSON шага по «…», ручной режим блокирует «Повторить»/«Показать»,
  «Скопировать» выделение, меню-лист на телефоне, Cmd/Ctrl+\ для чата, красная точка проваленной проверки.
- Гейт модуля зелёный по коду возврата (shared, web-reader-contracts, web-reader, web-recorder, web-reader-app,
  browser-runner, целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- Общий тип `BrowserSelectorAction` в `packages/shared/src/types.ts` дублирует перечисления действий панели:
  расширяя `to`/параметры в `previewActions.ts`, надо править и его, иначе `planModelAction` не типизируется.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 09.

## Открытые вопросы / что осталось

- Циклы 10–20.

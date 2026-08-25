---
title: web-reader-parity-pack
date: 2026-08-25
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# web-reader-parity-pack

## Что сделано

- Пакет «паритет с Claude in Chrome»: 9 новых действий превью (network, console,
  evaluate, drag, set, upload, forward, viewport, a11y) + расширенный click
  (dblclick, правая кнопка, модификаторы). MCP-инструментов «browser» стало 25.
- Контракт/валидатор/лимиты — packages/shared/src/previewActions.ts; исполнение —
  инъецированный скрипт previewProxy (буферы network 200 / console 300 записей);
  viewport исполняет Recorder сам (ширина обёртки iframe, 0 — адаптив).
- Диагностическая страница дополнена select/checkbox/file/dblclick/drag-целями;
  самодиагностика — 31 шаг, живой прогон в браузере 31/31.
- Гейты: shared 553, server 1276, ui 1761, web-recorder 21, web-reader-app 27,
  typecheck всех воркспейсов.

## Что выяснили (факты, которых не было в KB)

- el.click() не передаёт кнопку/модификаторы — расширенный клик обязан идти
  полным событийным путём pointer/mouse down→up (+contextmenu для правой).
- Идемпотентный set чекбокса — нативный клик только при расхождении checked:
  события input/change/click получаются честными, повторный вызов — no-op.
- jsdom не имеет DataTransfer и elementFromPoint: upload в тестах проверяется
  по error-ветке, elementFromPoint в drag обёрнут в try (fallback body).

## Куда занесено

- docs/kb/ui.md — раздел «Паритет с браузерным плагином…» (+ что осознанно не переносится).

## Открытые вопросы / что осталось

- forward не включён в самодиагностику (back/forward через реальные загрузки
  прокси-страниц хрупок в ретраях); действие покрыто jsdom-тестом.
- Пиксельные скриншоты/WS чужих окружений/мультивкладки — зона playwright-reader.

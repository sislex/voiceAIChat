---
title: web-reader-user-like-cycle-14
date: 2026-09-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# web-reader-user-like-cycle-14

## Что сделано

- Цикл 14 серии «Web Reader: браузер как у пользователя»: остановка опасных действий до подтверждения
  (`needsConfirmation` → отказ MCP с инструкцией; `confirm` у click/fill/choose), `type {secret}`, `show {all}`,
  `hover.cursor`, `read.frames`, `open.crossSite`, `status.checks`, favicon по умолчанию; в панели — запрос
  подтверждения с «Разрешить»/«Отказать», рассказ ленты о подтверждении и смене сайта, минуты ручного режима.
- Гейт модуля зелёный по коду возврата (shared, web-reader, web-recorder, web-reader-app, web-reader-contracts,
  целевые тесты ui).

## Что выяснили (факты, которых не было в KB)

- Список опасных слов (`DANGER` в скрипте страницы) — эвристика на русском и английском; проектная политика
  `commandPolicy` на него не влияет, это отдельный слой осторожности панели.

## Куда занесено

- docs/kb/ui.md — «Действия модели в превью» и «Живые действия и безопасность Web Reader».
- docs/plans/web-reader-user-like-browsing-20-cycles.md — таблицы цикла 14.

## Открытые вопросы / что осталось

- Циклы 15–20.

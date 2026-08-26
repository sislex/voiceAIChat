---
title: make-publish-check-templates
date: 2026-08-26
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# make-publish-check-templates

## Что сделано

-

## Что выяснили (факты, которых не было в KB)

-

## Куда занесено

- docs/kb/…

## Открытые вопросы / что осталось

-

Make, итерация 2: публикация проекта по ссылке `/p/<token>/` без входа, статическая проверка
(`check()` + MCP `make_check`, якоря `#id` и `url(#id)` не считаются файлами), шаблоны проекта,
самодиагностика Make (`makeDiagnostics.ts`). Проверено в Chrome на локальном стенде :8799 —
публикация отдаёт 200 без инспектора, диагностика 4/4. Обновлены ui.md, protocol.md,
server-internals.md, llm.md.

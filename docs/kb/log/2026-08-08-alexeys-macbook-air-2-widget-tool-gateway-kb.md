---
title: widget-tool-gateway-kb
date: 2026-08-08
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# widget-tool-gateway-kb

## Что сделано

- Уточнено фактическое устройство операций `describe/get`, UI-first query и подтверждённого action канбан-шлюза.
- Зафиксированы границы гарантий аудита и идемпотентности.

## Что выяснили (факты, которых не было в KB)

- Replay-кэш `widgetIdempotency` живёт только в памяти процесса сервера.
- Audit действия — структурированное событие `widget.action` в runtime-log, отдельной таблицы аудита нет.

## Куда занесено

- `docs/kb/projects.md#универсальный-ассистент-виджета`

## Открытые вопросы / что осталось

- Нет.

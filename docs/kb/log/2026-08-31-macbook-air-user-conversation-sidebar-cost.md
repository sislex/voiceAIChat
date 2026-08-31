---
title: conversation-sidebar-cost
date: 2026-08-31
machine: macbook-air-user
author: NikolayTola
---

# conversation-sidebar-cost

## Что сделано

- Сверен серверный агрегат стоимости разговоров, отображение в Sidebar и обновление chat store после `claude.done`.
- Дополнены темы backend и UI, обновлены свежесть и производный индекс.

## Что выяснили (факты, которых не было в KB)

- Полнота агрегата определяется по каждому сохранённому AI-ходу: нужны числовые usage и тариф фактических provider/model; при partial и unknown сервер не возвращает заниженную сумму.
- Sidebar показывает сумму только для known, обозначает partial тире и скрывает unknown; после done перечитывает серверный список в том числе для фонового разговора.

## Куда занесено

- docs/kb/server-internals.md
- docs/kb/ui.md

## Открытые вопросы / что осталось

- Нет.

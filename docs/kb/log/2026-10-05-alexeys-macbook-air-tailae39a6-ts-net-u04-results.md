---
title: u04-results
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# u04-results

## Что сделано

- Записаны итоги U04 (этап 4 окружений) в docs/plans/environments.md.

## Что выяснили (факты, которых не было в KB)

- Перенос тома файлов прода 6,5 ГиБ через туннель агента идёт ~57 МБ/мин и не укладывается в
  60-минутный таймаут загрузки Kanban.
- Копии Make не делят данные проектов: файлы в `<dataDir>/make/<conversationId>`, счётчики ревизий и
  очереди — в памяти экземпляра.

## Куда занесено

- docs/plans/environments.md — раздел «Итоги U04».

## Открытые вопросы / что осталось

- Передача архивов `migrate` по VPN или со сжатием; `cutover` с владельцем.

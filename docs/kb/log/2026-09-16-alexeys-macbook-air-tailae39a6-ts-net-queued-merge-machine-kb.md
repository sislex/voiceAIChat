---
title: queued-merge-machine-kb
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# queued-merge-machine-kb

## Что сделано

Дополнена тема merge-runner актуальным контрактом смены машины queued-рана,
согласованием с исполнением очереди и доставкой realtime-снимков.

## Что выяснили (факты, которых не было в KB)

Merge использует собственный процесс-глобальный слот и отложенный callback, а не
FIFO development CI. Исполнение атомарно claim-ит queued-строку и берёт машину из
зафиксированного результата. После смены машины snapshot получают все активные
участники проекта; доска инвалидируется отдельно.

## Куда занесено

- docs/kb/features/merge-runner.md

## Открытые вопросы / что осталось

Нет.

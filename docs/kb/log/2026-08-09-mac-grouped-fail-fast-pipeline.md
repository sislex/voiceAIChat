---
title: grouped-fail-fast-pipeline
date: 2026-08-09
machine: mac
author: alexeyrozhnov
---

# grouped-fail-fast-pipeline

## Что сделано

- Сверены shared-контракты, coordinator и SQL-схема группированного test pipeline.
- Уточнена существующая тема CI-runner и перегенерирован индекс KB.

## Что выяснили (факты, которых не было в KB)

- Добавлена отдельная от CiRun модель TestRun/TestGroupRun с восемью базовыми группами и привязкой к одному commit SHA.
- Coordinator выполняет группы последовательно, останавливает хвост после обязательного падения, проверяет Playwright preview SHA и разделяет полный и точечный повторы.
- В этой задаче подготовлены контракты и таблицы, но конкретные DB, HTTP/WS, UI и runner-адаптеры ещё не подключены.

## Куда занесено

- docs/kb/features/ci-runner.md

## Открытые вопросы / что осталось

- End-to-end подключение coordinator к персистентности, API/WS, UI и реальным исполнителям остаётся за следующей реализацией.

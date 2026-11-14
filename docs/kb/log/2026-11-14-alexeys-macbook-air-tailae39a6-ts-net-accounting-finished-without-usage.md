---
title: accounting-finished-without-usage
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# accounting-finished-without-usage

## Что сделано

- Запуск, чей процесс завершился сам без итогового расхода (квитанция `finished`, `finalUsage: false`), закрывается с нулевым списанием (`no-usage:<id>`); квитанция `uncertain` по-прежнему держит резерв.

## Что выяснили (факты, которых не было в KB)

- На проде модель, отклонённая провайдером (`gpt-6-luna`: `model_not_found` для учётной записи ChatGPT, `turn.failed`, код 1), давала квитанцию без расхода; запись учёта навсегда оставалась `dispatching` и занимала слот токена API моделей. Способа закрыть такой резерв не существовало.

## Куда занесено

- docs/kb/data-auth.md

## Открытые вопросы / что осталось

-

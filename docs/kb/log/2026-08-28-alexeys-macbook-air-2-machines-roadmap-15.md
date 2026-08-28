---
title: machines-roadmap-15
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-15 — групповая команда

## Что сделано

- `POST /api/agents/exec-batch` + `BatchExecResult`; блок «Групповая команда» на странице машин; тесты сервера и UI.
- Стенд: команда на двух машинах → сводка «успешно 2», вывод раскрывается построчно.

## Что выяснили

- Прод-main ушёл вперёд на 9 merge-коммитов (merge-раны прода) — локальный коммит пришлось ребейзить; конфликт только в генерируемом `docs/kb/README.md` (решается `npm run kb:index`), после ребейза гейт прогнан заново.

## Куда занесено

- docs/kb/machines.md — «Групповая команда».

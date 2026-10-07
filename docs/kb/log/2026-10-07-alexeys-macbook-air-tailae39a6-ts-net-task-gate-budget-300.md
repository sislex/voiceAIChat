---
title: task-gate-budget-300
date: 2026-10-07
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# task-gate-budget-300

## Что сделано

- Бюджет гейта задачи (`npm run gate:task`) поднят с 60 до 300 секунд (5 минут) по решению
  владельца 2026-10-07; лимит 1000 тестов не изменился. `scripts/task-gate.mjs`
  (`maxSeconds = 300`, сообщение о превышении строится из лимитов) и его тесты.
- Обновлён «Общий контракт» в `docs/plans/dev-lane-v1.md` и бюджет в `testing-operations.md`
  (там ещё стояло устаревшее «100 тестов»).

## Что выяснили (факты, которых не было в KB)

- Тот же бюджет поднят отдельными PR в Kanban, Core UI, Make, Agent, Web Reader и Playwright Reader
  (ветки `dev`).

## Куда занесено

- docs/kb/testing-operations.md
- docs/plans/dev-lane-v1.md

## Открытые вопросы / что осталось

- Исторические планы (`task-gate-scope-v1.md`, таблица задач dev-lane-v1) оставлены как есть.

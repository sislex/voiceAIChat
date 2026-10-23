---
title: pin-kanban-0-2-36
date: 2026-10-24
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-36

## Что сделано

- Kanban 0.2.36 (b9725bae) закреплён в Core: `deploy/tools.lock.json`, `docker-compose.yml`, `docs/kb/deploy.md`.
- В выпуске SK-69: история `temporary-resources.json` ограничена (500 попыток, 7 дней), замок очистки снимается на время вызовов машин, брошенные `.tmp` удаляются.

## Что выяснили (факты, которых не было в KB)

- На проде файл очистки Kanban разросся до 9,8 МБ (8700 попыток). Синхронный разбор и сохранение на каждом взятии замка останавливали все API Kanban на 20–50 с, а при зависшем агенте машины замок держался минутами.

## Куда занесено

- docs/kb/deploy.md (версия Kanban)

## Открытые вопросы / что осталось

- Нестабильный тест `sharedHost.test.ts` (вход через `/_sislexa/enter`, 401 вместо 302 под нагрузкой полного гейта).

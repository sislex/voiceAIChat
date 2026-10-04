---
title: pin-kanban-0-2-2
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-kanban-0-2-2

## Что сделано

- Закреплён Kanban 0.2.2 (`853fcf24`, sislex/sislexa-kanban#32): доступ стенда из локальной сети
  находит частный адрес физического интерфейса, если маршрут по умолчанию занят exit node.

## Что выяснили (факты, которых не было в KB)

- U04: у M1 с exit node Tailscale маршрут по умолчанию идёт через `utun8` (100.x), адрес LAN
  192.168.1.9 — на `en0`; подготовка `u04-check` падала на `settings` с «Machine has no private LAN address».
- На свежем Linux-сервере без контейнеров `docker0` в состоянии NO-CARRIER, и Node
  (`os.networkInterfaces()`) его не возвращает; агент падал с «Docker bridge gateway is unavailable».
  Исправлено в sislex/agent#9 (выпуск агента после U04), на s1 временно стоит контейнер `docker0-keepalive`.

## Куда занесено

- docs/kb/deploy.md — закреплённая версия Kanban.

## Открытые вопросы / что осталось

- Выпуск агента с исправлением `docker0`, обновление агентов, удаление `docker0-keepalive` на s1.

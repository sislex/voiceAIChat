---
title: kanban-linux-image-pin
date: 2026-10-01
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-linux-image-pin

## Что сделано

- Закреплён локальный образ Kanban из исходного коммита `29d66f4e0eb36d6ffe4d4e2240961ebb01d85183`.
- Образ собран для `linux/amd64` с полным Kanban gate и проверен запуском с временным PostgreSQL.

## Что выяснили (факты, которых не было в KB)

- Предыдущий закреплённый коммит `e139f854c050d9caa1ddbea00aff8409190fbef8` не собирался на Linux: тестам очистки требовался `lsof`, а `awk` выдавал число свободных байтов в экспоненциальной записи, которую POSIX `test -ge` не принимает.

## Куда занесено

- docs/kb/deploy.md

## Открытые вопросы / что осталось

- Нет.

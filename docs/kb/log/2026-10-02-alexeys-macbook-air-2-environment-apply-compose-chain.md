---
title: environment-apply-compose-chain
date: 2026-10-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# environment-apply-compose-chain

## Что сделано

- `scripts/prod/environment-apply.sh` до любых изменений определяет базовую цепочку compose
  (переменная процесса → `COMPOSE_FILE` из `.env` чекаута → стандартные файлы) и добавляет
  `current.yml` последним; без цепочки — exit 2. Тесты на запуск без `COMPOSE_FILE`.

## Что выяснили (факты, которых не было в KB)

- Kanban (`apps/server/src/environments/machine.ts`) запускает скрипт `cd <checkout> && bash …`
  без `COMPOSE_FILE`; на проде цепочка из 12 файлов лежит только в `.env` чекаута. Прежний
  экспорт одного `current.yml` её затенял.

## Куда занесено

- docs/kb/deploy.md — «Окружения: наблюдение и переключение образов».

## Открытые вопросы / что осталось

- Проверка «Применить»/«Откатить» на проде — U01 после выката релиза с исправлением.

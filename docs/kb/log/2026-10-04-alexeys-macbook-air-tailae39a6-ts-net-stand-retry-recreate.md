---
title: stand-retry-recreate
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-retry-recreate

## Что сделано

- Перед повтором `compose up` скрипт стенда удаляет контейнеры проекта в состоянии `created`.

## Что выяснили (факты, которых не было в KB)

- U04 на ядре 0.1.395: повтор запуска прошёл, но `voicechat`, у которого первая попытка не смогла
  настроить порт, был запущен без сетей и перезапускался с `getaddrinfo EAI_AGAIN postgres`; шаг
  `health` упал с «Couldn't connect to server». Диагностика из #362 показала причину в операции.

## Куда занесено

- docs/kb/deploy.md — опции стенда этапа 4, повтор запуска.

## Открытые вопросы / что осталось

- Перевести `u04-check` на ядро с исправлением и завершить U04.

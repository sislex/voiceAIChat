---
title: pin-core-ui-1-5-0
date: 2026-10-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-core-ui-1-5-0

## Что сделано

- Закреплён Core UI 1.5.0 (`9b6264a5`): UI окружений v4, shared 0.1.18 и agent-contracts 1.2.1, служебные данные чата по настройке.

## Что выяснили (факты, которых не было в KB)

- Выпуск ловит то, что не видит быстрый гейт воркера: peer agent-contracts 1.2.1 у shared 0.1.18 и серверную отрисовку `ChatColumn` в проверке потребителя (Core UI #48, #49).

## Куда занесено

- docs/kb/clients.md — версия Core UI.

## Открытые вопросы / что осталось

- Проверить на разговоре Make из замера после релиза ядра.

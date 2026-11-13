---
title: owner-npm-pins-train-e0dce216
date: 2026-10-31
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# owner-npm-pins-train-e0dce216

## Что сделано

- Закреплены npm-архивы владельцев из поездов e0dce216 и 6a4f9587: Make 1.8.6, Playwright Reader 1.2.7, Web Reader 1.3.6, Voice 1.1.2 с контрактами. Image Studio оставлен 1.1.2: `@sislexa/chat-ui` требует ровно эту версию (peer).
- В `makeBridge/projectAdapters.ts` компоненты стенда сужены до значений контракта Make 1.8.6 (`core`, `core-ui`, `make`).

## Что выяснили (факты, которых не было в KB)

- Прод отдаёт интерфейсы приложений из npm-архивов, закреплённых в Core. Поезд закрепляет только образы, поэтому без отдельного npm-закрепления новый Make UI на прод не попадает.

## Куда занесено

- docs/kb/log (эта запись)

## Открытые вопросы / что осталось

- Научить поезд закреплять npm-архивы владельцев вместе с образами.

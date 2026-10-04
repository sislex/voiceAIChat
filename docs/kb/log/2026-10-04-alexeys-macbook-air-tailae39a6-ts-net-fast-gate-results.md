---
title: fast-gate-results
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# fast-gate-results

## Что сделано

- Ран быстрого гейта принят; итоги, замеры и решение не включать фоновую проверку main —
  docs/plans/delivery-fast-gate.md «Итоги рана».

## Что выяснили (факты, которых не было в KB)

- Полные гейты Core, core-ui и Delivery Control не проходят в песочнице воркера macOS (браузер, host-тесты),
  поэтому фоновая проверка main там дала бы ложные регрессии.

## Куда занесено

- docs/plans/delivery-fast-gate.md.

## Открытые вопросы / что осталось

- Включить профиль проверки main после починки Chromium в песочнице; проверить git в песочнице гейта.

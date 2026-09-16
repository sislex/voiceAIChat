---
title: vpn-marker-discovery-kb
date: 2026-09-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# vpn-marker-discovery-kb

## Что сделано

- Уточнена документация discovery покрытия обязательных VPN-кейсов на integration_tests.

## Что выяснили (факты, которых не было в KB)

- Раннер ищет `@testCase` только в тестовых файлах из feature diff (с first-parent fallback) и сопоставляет полный ID кейса; маркеры в неизменённых тестах не учитываются.

## Куда занесено

- `docs/kb/machines.md`, раздел «Verification and acceptance limits».

## Открытые вопросы / что осталось

- Real-host VPN matrix остаётся отдельной opt-in приёмкой и этим изменением не запускалась.

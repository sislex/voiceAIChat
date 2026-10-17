---
title: pin-shared-0-1-33
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-33

## Изменения

Shared 0.1.33 — тот же контракт, что 0.1.32, но peer-диапазон `@sislexa/identity` расширен до `>=1.4.2 <1.6.0`
ради Identity 1.5.0 (API-токены). Архив `voicechat-shared-0.1.33-eb9abc5a5763.tgz` собран из коммита `b33170a6`.

## Проверка

`npm run gate:quick -- --base origin/dev`; `scripts/vendor-archives.test.mjs` подтверждает, что старый архив 0.1.32 удалён.

---
title: freeze-desktop
date: 2026-10-18
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# freeze-desktop

## Что сделано

- Desktop помечен замороженным (`frozen` в `dependency-snapshots.json` и `vendor/owner-artifacts.json`):
  проверки встроенного renderer пропускаются, закрепление Desktop не тянет браузерные наборы фронтенда.

## Что выяснили (факты, которых не было в KB)

- Единственная жёсткая связка Core UI ↔ Desktop была в `verifySnapshot` (`Desktop embeds different renderer`):
  из-за неё каждый выпуск Core UI требовал выпуск Desktop. Electron QA уже был опциональным (`VC_ELECTRON_TESTS=1`).

## Куда занесено

- docs/kb/clients.md (Desktop is frozen).

## Открытые вопросы / что осталось

- Операторский скрипт `sislexa-core-ui-release` (вне репозитория) всё ещё выпускает Desktop — нужен вариант без Desktop.

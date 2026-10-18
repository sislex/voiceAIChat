---
title: pin-shared-0-1-37
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-shared-0-1-37

## Что сделано

- Выпущен и закреплён Shared 0.1.37 (`voicechat-shared-0.1.37-36057d92c14c.tgz`, коммит `4291f52a`): те же контракты,
  что 0.1.36 (deployment-profiles-v1 B01), но все пиры пакетов Core помечены необязательными.

## Что выяснили (факты, которых не было в KB)

- Сервисам с Shared 0.1.36 приходилось бы ставить девять приватных пакетов Core; с 0.1.37 достаточно архива Shared
  (и agent-contracts 1.5.0 для component-runtime 1.1.0).

## Куда занесено

- dependency-snapshots.json, vendor/owner-artifacts.json; docs/kb/shared.md.

## Открытые вопросы / что осталось

- Пины Shared 0.1.37 в сервисах этапа 1 deployment-profiles-v1.

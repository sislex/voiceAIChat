---
title: external-stand-proxy
date: 2026-11-05
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# external-stand-proxy

## Что сделано

- StandProxy умеет внешний источник `{ kind: 'external', origin }`: стенд Make с внешним адресом (например, https://stg-02.mrdstaging.com/webapp/) открывается через аренду прокси с инспектором, куки входа работают внутри iframe.
- RPC `userStand { op: 'preview', url }` выдаёт аренду `ue-<hash>` с `interactive: true`.
- Защита от SSRF (`standExternal.ts`): внутренние, loopback, link-local и metadata-адреса отклоняются кодом `stand_url_forbidden`, адрес закрепляется на соединение; `VC_STAND_PROXY_ALLOW_PRIVATE=1` только для тестов.

## Что выяснили (факты, которых не было в KB)

- `net.BlockList` сам сопоставляет IPv4-правила с IPv4-mapped IPv6; подсеть `::ffff:0:0/96` в правилах блокирует и все обычные IPv4.

## Куда занесено

- docs/kb/server-internals.md (user stands, внешние стенды)

## Открытые вопросы / что осталось

- Карта `ue-` → origin в памяти: после перезапуска Core Make должен заново запросить preview.

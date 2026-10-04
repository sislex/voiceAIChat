---
title: vpn-link-exit-node-guard
date: 2026-10-04
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# vpn-link-exit-node-guard

## Что сделано

- `VpnService.linkAddress` пропускает ошибки выхода в интернет (`guard`, `forwarding`, `conflict`), как
  и `vpnMachineView` (#355): связь окружения идёт по VPN между машинами, которые сами пользуются exit node.

## Что выяснили (факты, которых не было в KB)

- U04: у M1 и MacBook владельца ошибка `guard` (exit node без службы защиты), и даже при применённом
  доступе окружения связи уходили бы в туннель агента.
- Kanban до 0.2.4 вообще не запрашивал доступ окружения (`machines.ensureEnvironmentGrant`), поэтому
  все связи `u04-check` шли через туннель.

## Куда занесено

- docs/kb/machines.md — какие ошибки VPN не мешают связям окружения.

## Открытые вопросы / что осталось

- U04: пересоздать связи `u04-check` после релиза и проверить, что они идут по VPN.

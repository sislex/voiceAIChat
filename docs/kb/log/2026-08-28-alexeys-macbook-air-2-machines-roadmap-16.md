---
title: machines-roadmap-16
date: 2026-08-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# machines-roadmap-16 — обновление агентов из админки

## Что сделано

- `updateAgentOnMachine` вынесен из роута; админский роут; `AgentFleetUpdate` с канареечным сценарием; версии машин в `AdminUserInfo.agents`.
- Стенд: секция видна во вкладке «Машины пользователя», роут отвечает 404/403 корректно; реальное обновление на стендовых агентах (запущены из исходников) не запускалось.

## Куда занесено

- docs/kb/machines.md — «Обновление агентов из админки».

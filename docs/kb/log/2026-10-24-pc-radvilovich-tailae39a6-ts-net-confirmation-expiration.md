---
title: confirmation-expiration
date: 2026-10-24
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# confirmation-expiration

## Что сделано

- Added confirmation deadlines and addressed expiration events to the Core widget relay and public protocol.
- Added tests distinguishing expiration, late acceptance and explicit rejection.

## Что выяснили (факты, которых не было в KB)

- Core owns the production widget relay; Kanban calls it through widgets.uiRequest. Core UI owns the confirmation dialog in its separate repository.

## Куда занесено

- docs/kb/protocol.md

## Открытые вопросы / что осталось

- Core UI and Kanban changes are committed in their owner SK-68 branches; publication remains with the delivery workflow.

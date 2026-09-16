---
title: ci-run-feed-contracts
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# ci-run-feed-contracts

## Что сделано

- Уточнён контракт лога, realtime-вопросов и повтора с выбранного шага.

## Что выяснили (факты, которых не было в KB)

- `CiLogLine` хранит transport chunks; физические строки получают только после их склейки.
- Повтор продолжается в том же ране и workspace по текущим слотам; неоднозначный command id требует полного повтора.
- `TaskRunFeed` и `DevelopmentRunFeed` получают вопросы через отдельную подписку `onInteraction`.

## Куда занесено

- docs/kb/features/ci-runner.md, раздел «Контракт и UI».

## Открытые вопросы / что осталось

- Нет.

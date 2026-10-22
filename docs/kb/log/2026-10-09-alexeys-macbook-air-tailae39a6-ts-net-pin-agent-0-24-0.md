---
title: pin-agent-0-24-0
date: 2026-10-09
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# pin-agent-0-24-0

## Что сделано

- Закреплены агент 0.24.0 и контракты агента 1.4.0 (`vendor/`, корень, `apps/server`, `packages/shared`,
  `packages/component-runtime`). Выпуск: https://github.com/sislex/agent/releases/tag/v0.24.0.

## Что выяснили (факты, которых не было в KB)

- До 0.24.0 подмена компонента стенда сообщала об успехе, а манифест стенда оставался на остановленном
  процессе — шлюз отвечал `dev_upstream_unavailable` (стенд M1, 2026-10-08).

## Куда занесено

- docs/kb/deploy.md — раздел о закреплённой версии агента.

## Открытые вопросы / что осталось

- Агент на машинах обновится после выкатки Core с этим закреплением (команда установки берёт агента из Core).

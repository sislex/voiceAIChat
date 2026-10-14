---
title: ui-delivery-step-diagnostics
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# ui-delivery-step-diagnostics

## Что сделано

- release-reliability-v1 B01: `scripts/prod/ui-delivery.py` отслеживает текущий шаг и пишет
  `ui_delivery_rejected: step=<step>: <ExceptionClass>`; упавшая дочерняя команда даёт `CommandFailed` с кодом и хвостом stderr.
- `scripts/browser-ui-release.test.mjs`: обёртка `runCommand` без 15-секундного предела (120 с), при ошибке — `code`, `signal`,
  `killed`, `stderr`, `stdout`; фейки `docker`/`verify` переписаны на python3.

## Что выяснили (факты, которых не было в KB)

- Релиз 0.1.455 упал из-за SIGTERM по `timeout: 15000` в тесте под нагрузкой регрессии, без stderr.

## Куда занесено

- docs/kb/deploy.md (Controlled browser UI deployment authority)

## Открытые вопросы / что осталось

- нет

---
title: compose-tool-transit-flag
date: 2026-11-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# compose-tool-transit-flag

## Что сделано

- `docker-compose.yml` передаёт контейнеру Core переменную `VC_MODEL_API_TOOL_TRANSIT` (по умолчанию `false`).

## Что выяснили (факты, которых не было в KB)

- Окружение сервиса `voicechat` в Compose задано явным списком: переменная из `.env` чекаута, не перечисленная в `docker-compose.yml`, в контейнер не попадает. Флаг транзита из #969 поэтому нельзя было включить на проде.

## Куда занесено

- docs/kb/llm.md

## Открытые вопросы / что осталось

- Включение на проде: `VC_MODEL_API_TOOL_TRANSIT=true` в `.env` чекаута и пересоздание сервиса `voicechat` — по слову владельца.

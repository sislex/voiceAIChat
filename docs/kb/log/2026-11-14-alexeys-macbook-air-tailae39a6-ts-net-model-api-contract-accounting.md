---
title: model-api-contract-accounting
date: 2026-11-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# model-api-contract-accounting

## Что сделано

Сверены публичный адаптер Core, ChatAccounting, durable outbox, RemoteLlmClient
и канонический HTTP-контракт владельца llm-runner. Закрыты два пробела KB:
публикация моделей с расходом по token sid и адрес документации runner API.

## Что выяснили (факты, которых не было в KB)

Runner принимает плоское тело `POST /v1/run`, возвращает `x-run-id` и NDJSON
с сырыми stdout/stderr и финальным exit; переданный вызывающей стороной runId
позволяет отменять ход до получения заголовков. Публичный Core сохраняет этот
транспорт, но создаёт отдельный operation ID для Billing и квитанций.

Модельный API регистрирует сессию проверенного токена, резервирует расход до
dispatch и сохраняет sid также в `application.tokenId`. Отмена и разрыв
соединения завершаются сверкой фактической квитанции, а подтверждённый расход
агрегируется по sid и tenantId в `/api/me/usage`.

## Куда занесено

- docs/kb/llm.md
- docs/kb/architecture.md
- docs/kb/deploy.md

## Открытые вопросы / что осталось

Нет.

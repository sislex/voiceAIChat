---
title: core-admin-storage-quota-kb-reconciliation
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# core-admin-storage-quota-kb-reconciliation

## Что сделано

- Сверены Core admin quota route, Shared-контракт, storage runtime и обязательные темы merge-рана.
- Закрыт диагностический пробел о плавающем `ticket_invalid` в redeem fixture.

## Что выяснили (факты, которых не было в KB)

- Валидатор redeem требует `delegation.expiresAt <= session.expiresAt`; два независимых чтения часов в fixture могли нарушить это условие.
- Успешный HTTP-ответ с невалидной формой redeem преобразуется `TrustedCoreRegistry` в `ticket_invalid`.

## Куда занесено

- `docs/kb/data-auth.md` — квоты Core admin и диагностика shared-service redeem.
- `docs/kb/deploy.md`, `docs/kb/server-internals.md`, `docs/kb/shared.md` — обязательная сверка и свежесть на merge SHA.

## Открытые вопросы / что осталось

- Core UI-поле квоты остаётся отдельной задачей после публикации контракта.

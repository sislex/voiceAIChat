---
title: s3-application-attribution
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# S3 application attribution bridge

## Что сделано

- Pinned clean SDK, Billing, Runner and Runner contract archives from their owner repositories.
- Carried the verified application snapshot into Core accounting requests and runner contexts.
- Compared Billing and Runner snapshots with the durable Core outbox before settlement.
- Applied the reviewed A04 socket isolation and credential-release patch.

## Что выяснили (факты, которых не было в KB)

- The historical Billing `origin_application_id` column contains a product module; actual application attribution now uses a separate nullable snapshot.
- Runner receipts previously normalized the module to their service owner but did not retain an application ID.

## Куда занесено

- docs/kb/data-auth.md
- docs/kb/protocol.md

## Открытые вопросы / что осталось

- A04 still needs standalone delegated client admission, resource-specific child tools, and end-to-end acceptance before S3 can close.

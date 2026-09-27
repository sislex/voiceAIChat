---
title: c03-chat-contracts
date: 2026-09-27
machine: delivery-c03
author: unknown
---

# c03-chat-contracts

## Что сделано

- Added the additive REST/WS chat context, settings and reconnect contract.
- Added verified application-context, access-decision, settings and reconnect adapters with tests.
- Added a canonical frozen contract manifest with a pinned SHA-256 digest.

## Что выяснили (факты, которых не было в KB)

- SDK application attribution is evidence carried by the context, but authorization still requires independent permission, resource and live capability checks.
- Every reconnect must reverify the context; missed state is recovered from authoritative snapshots when replay cannot resume.

## Куда занесено

- `docs/kb/protocol.md`

## Открытые вопросы / что осталось

- Registry publication and consumer commissioning happen only after an authorized commit/release operation.

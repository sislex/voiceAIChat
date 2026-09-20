---
title: tenant-tariff-production
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# tenant-tariff-production

## Changes

Published and deployed Core 0.1.316 with Identity 1.1.1 through installed
voicechat-deploy. Retained current provider credentials, dependency URLs and
session/database configuration. Completed the tenant/tariff delivery checklist.

## Validation

Both complete Core gates passed before release, including 807 browser tests each.
Verified all fourteen application containers and eight providers, pre-upgrade
session continuity, personal tenant backfill and atomic new-user provisioning.
Live API checks covered tenant isolation, capability changes, revision conflicts,
CSRF, admin recovery and stale WebSocket closure. Mobile browser checks saved and
assigned a tariff without page errors. Real Piper/Whisper round-trip passed.
Removed temporary accounts, relationships, sessions, tariff and private credential
files; final database cardinality checks passed.

## Knowledge updated

- docs/kb/deploy.md: exact release, backup, image and production proof.
- docs/plans/tenant-tariffs.md: completed delivery checklist.

## Operational follow-up

Unused builder cache cleanup reclaimed 366.9 MB without removing images or volumes.
Root filesystem has approximately 1.2 GiB free; increase capacity before another
large image build. Prices, payment collection, shared organizational tenants and
token-credit ledgers remain separate future scope.

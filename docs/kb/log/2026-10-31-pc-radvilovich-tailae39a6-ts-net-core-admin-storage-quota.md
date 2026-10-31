---
title: core-admin-storage-quota
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# core-admin-storage-quota

## Changes

- Added Core admin quota PATCH validation, Identity setter integration and storage usage in user responses.
- Added Shared admin fields and IPC declaration, plus route integration tests.

## Verified facts

- Pinned Identity 1.5.2 lacks FS-3 quota methods; Core responds with 503 when the setter is unavailable.
- Storage service usage includes effective quota and counts owner files even when the storage node is offline.
- The shared-service redeem fixture used two wall-clock reads for session and delegation expiry; crossing a millisecond could violate the validator's delegation-expiry <= session-expiry rule. It now uses one timestamp.

## Updated topic

- docs/kb/data-auth.md, File storage metadata and quotas.

## Follow-up

- Deploy an FS-3-capable Identity and wire the Core UI after contract publication.

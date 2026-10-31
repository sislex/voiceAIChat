---
title: sisl813-kb-gate-repair
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# sisl813-kb-gate-repair

## Changes

Reviewed both stale topics and the three commits affecting their areas since
47b29314: the direct-transfer implementation, thumbnail support and their merge.
Updated the existing file-storage sections before refreshing checked markers.

## Verified facts

Internal node blob/health routes use Core bearer authentication; direct GET/PUT
use HMAC capabilities with a five-minute limit. Reservations remain invisible
until commit verifies node HEAD. Shared also declares thumbnail sizes, HTTP 415
and optional thumbnailAvailable fields; Core injects the thumbnail generator.

## Updated topics

- docs/kb/architecture.md
- docs/kb/shared.md

## Validation

git diff --check passes. kb:check --strict no longer reports architecture.md or
shared.md. Its remaining 21 topics match the pre-existing warnings listed by the
failed workflow's scoped check. No code or gate command changed; the workflow
will rerun its complete command.

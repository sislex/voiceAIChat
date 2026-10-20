---
title: Component grant renewal prevention
date: 2026-10-20
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Component grant renewal prevention

## Implementation

Added a standalone default-read-only expiry/readiness checker and an explicit
commissioned renewal mode. The script binds exact local installation paths,
contracts, grant policy and Docker mounts, preserves credential ownership, and
uses durable intents to avoid repeating an uncertain issuance. Added hourly
systemd commissioning templates; nothing is installed on production.

## Incident and validation

Production Make and Core grants expired on 2026-10-20 at 08:52:39 UTC while their
liveness checks remained healthy. The operator separately repaired the two grants
without restarting or replacing the services and verified both preview revisions.

Disposable SQLite, file-safety, crash-recovery and running loopback-consumer tests
passed on physical M1 through the existing Delivery Control operator inbox.
Final source checks, independent review and the required full gate remain pending;
the focused checks are not production commissioning or a replacement for that gate.

## Knowledge updated

- docs/kb/deploy.md: commissioning, recovery, monitoring and incident boundaries.
- docs/kb/data-auth.md: maintenance leaves runtime authorization unchanged.

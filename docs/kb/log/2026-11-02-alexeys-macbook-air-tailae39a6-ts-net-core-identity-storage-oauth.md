---
title: core-identity-storage-oauth
date: 2026-11-02
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# core-identity-storage-oauth

## Changes

- Added the Core adapter for pinned auth-client, legacy mode selection, and user-bound Storage exchange.
- Added admin Storage navigation and disabled Core quota edits in Identity mode.
- Added OAuth transport and Core integration tests.

## Findings

- The pinned client supplies the OAuth flow and CSRF guard; the Core session store adds revocation on deletion.
- Storage usage is caller-scoped. Admin usage must not be copied into other users' rows.

## Documentation

- docs/kb/data-auth.md

## Commissioning

- Operators must register redirect URLs and configure Identity/Storage credentials and account access before switching. UI consumption belongs to the external Core UI repository.

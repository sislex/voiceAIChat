---
title: model-runner-api
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# model-runner-api

## Implementation

- Added the authenticated Core model runner API, token scope guard, admission limits and unchanged NDJSON forwarding.
- Reused ChatAccounting reservations, durable receipts and recovery; added sid attribution and personal token usage reporting.
- Added real HTTP compatibility and Billing integration coverage.

## Verified findings

- Identity's current pinned API token type supports full/read; Core accepts future verified models/tenant metadata without parsing unverified claims.
- Existing CLI accounting rejects finite monetary bounds. The model API preserves this admission rule.
- Cancellation/disconnection settlement uses private executor receipts rather than caller-supplied usage.

## Documentation

- docs/kb/llm.md
- docs/kb/agent-api-access.md

## Remaining external dependency

- Issuance of models tokens requires the separate Identity release; full API tokens are usable now.

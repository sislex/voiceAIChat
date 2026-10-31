---
title: sisl-808-storage-idempotency
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sisl-808-storage-idempotency

## Changes

Added idempotent owner/kind/ref creation for chat and Make spaces in the memory
and SQL stores. Chat uploads use the coordinator call. SQL uses a unique
canonical identity index without merging legacy spaces.

## Verified findings

Existing metadata stored kind/ref only in JSON; canonical identities now live
in storage_space_refs. Duplicate spaces remain visible. The shared contract
covers concurrent creation, scopes, null refs, legacy data and deletion.
SQL tests cover uniqueness and insert-conflict recovery.

## Knowledge topics

- docs/kb/data-auth.md: implementation and one-off cleanup procedure.
- docs/kb/architecture.md: coordinator creation and cleanup reference.

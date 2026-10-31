---
title: sisl-818-storage-thumbnails
date: 2026-11-01
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# sisl-818-storage-thumbnails

## Что сделано

- Added the authenticated storage thumbnail endpoint, derived-blob caching and Sharp generation.
- Exposed thumbnail availability for storage-backed chat image attachments.
- Added regressions for sizes, cache reuse, revision invalidation, media rejection and quota isolation.

## Что выяснили (факты, которых не было в KB)

- Derived previews need no metadata row or deployment variable; keys derive from the immutable source blob ID.

## Куда занесено

- `docs/kb/protocol.md`, `data-auth.md`, `server-internals.md`, and `deploy.md`.

## Открытые вопросы / что осталось

- Supervisor gate remains after focused checks.

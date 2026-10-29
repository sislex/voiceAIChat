---
title: thread-reset-summary-fallback
date: 2026-10-29
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# thread-reset-summary-fallback

## Changes

- Thread reset persists a bounded deterministic fallback when summary generation cannot cover pending messages.
- Added persisted optional summary source, bounded rolling model prompts, secondary runner retry and per-attempt timeout.
- Added structured stdout failure diagnostics and regression coverage for reset, queued work, model fallback and large history.

## Verified findings

- Fastify logging is disabled; summary failures previously routed through app.log.warn were dropped.
- Summary failure must not prevent session reset; active-turn admission remains protected.

## Updated topics

- docs/kb/llm.md
- docs/kb/server-internals.md

## Remaining work

- None.

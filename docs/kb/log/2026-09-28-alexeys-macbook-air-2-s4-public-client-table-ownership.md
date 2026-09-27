---
title: s4-public-client-table-ownership
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s4-public-client-table-ownership

## Work completed

- Added Identity's five public-client tables to Core's compatibility ownership manifest.

## Verified findings

- The pinned Identity S4 schema is additive; PostgreSQL translation and ownership tests require explicit ownership entries.

## Knowledge updated

- docs/kb/data-auth.md

## Remaining work

- Validate the external browser flow through a live Core public origin before S4 acceptance.

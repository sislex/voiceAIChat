---
title: PostgreSQL column reconciliation
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# PostgreSQL column reconciliation

## Work completed

- Restored production release 0.1.298 by adding the missing task-level manual-QA column.
- Split PostgreSQL bootstrap into table creation, generated missing-column reconciliation, and dependent schema objects.
- Added pure schema-plan coverage and a real PostgreSQL legacy-schema regression test.

## Findings that were missing from the KB

- PostgreSQL startup skipped SQLite migrations and relied on `CREATE TABLE IF NOT EXISTS`, which does not add columns to existing tables.
- Fresh-schema PostgreSQL tests could not detect this release-upgrade failure.

## Knowledge base destination

- `docs/kb/data-auth.md`, section “Schema”.

## Open questions

- None.

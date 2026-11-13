---
title: stand-create
date: 2026-11-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# stand-create

## Changes

- Added portable stand commands, private configuration, dev clones and Docker PostgreSQL fallback.
- Preserved the existing shared launcher and added stand tree exclusions.
- Added offline CLI checks; existing shared launcher tests pass.

## Verified facts

- Identity bootstraps admin from IDENTITY_ADMIN_PASSWORD; its default realm uses the same PostgreSQL public schema as Core.
- Portable mode uses text SQL seeds through psql, while legacy dev:stand retains custom-format pg_restore.

## Documentation

- docs/kb/deploy.md, «Стенд за 3 шага».

## Validation limits

- Stand CLI and legacy launcher: 20 tests passed; final CLI-only rerun: 12 passed.
- Task gate passed (npm run gate:task -- --base HEAD); KB-tools typecheck and 11 tests passed.
- Required npm run gate:fast expands to the full gate for these configuration changes. Three remote calls exceeded the 300-second MCP limit; no successful fast-gate result is claimed. The CI run_command tool was not available in this session.
- Live multi-repository startup and UI login were not performed on the protected developer stand.

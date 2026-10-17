---
title: delivery-control-assistant-credential
date: 2026-10-17
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# delivery-control-assistant-credential

## Changes

- Added the Kanban assistant credential file setting to Compose using the existing read-only secrets mount.
- Documented project-scoped coordinator operator credential provisioning, mode 0400, no printing, and disconnected behavior in docs/kb/deploy.md.
- Extended the Compose regression and fixed its service extraction to inspect the entire service.

## Validation and operator follow-up

- `node --import tsx --test scripts/application-build.test.mjs`: 7 tests passed.
- `npm run gate:task -- --base 2b16726ffe509e751fb4576b2d9c7135552cba05`: exit 255; direct invocation reports `spawnSync git EPERM`. Supervisor must rerun the gate.
- `node node_modules/typescript/bin/tsc --noEmit --allowJs --checkJs --target es2022 --module nodenext --skipLibCheck scripts/application-build.test.mjs`: exit 2, existing imported source typing and module-resolution errors (TS2835, TS2322, TS5097, TS2339, TS2353).
- KB touch, log and index commands were run. Git subprocess restrictions prevented revision detection; checked revision was recovered from direct `git rev-parse`. The generated index was restored because unavailable history incorrectly cleared unrelated stale-topic warnings; supervisor should regenerate it.
- Credential provisioning and connection commissioning remain operator steps. No credentials were accessed or changed and no services were started.

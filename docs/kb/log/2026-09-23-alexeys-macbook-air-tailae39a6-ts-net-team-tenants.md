---
title: team-tenants
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# team-tenants

## Completed

- Adopted Identity 1.4.2 team tenant contracts and storage.
- Added tenant ownership, legacy backfill and transactional transfer for projects and conversations.
- Applied the selected tenant to REST lists/resources, WebSocket authentication, commands and turn-time entitlement checks.
- Added isolation, WebSocket selection and legacy migration regressions.

## New verified facts

- Project membership and tenant membership intentionally remain separate.
- Explicit personal-project sharing remains available in personal context, while team context is strictly isolated.
- Existing Billing admission already shares policy and balance by tenant while retaining individual user attribution.
- Browser WebSockets require a query parameter for tenant selection because their API cannot add an HTTP header.

## Knowledge base updates

- `docs/kb/data-auth.md`
- `docs/kb/projects.md`

## Remaining release work

- Publish the matching Core contract, update Core UI, and complete production acceptance.

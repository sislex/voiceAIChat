---
title: production-0-1-330-team-tenants
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Production 0.1.330 team tenants

## Completed

- Released and deployed Core 0.1.330, Identity 1.4.2, Billing 1.2.2 and Core UI 1.4.0.
- Verified team creation, invitations, tenant isolation, project transfer, explicit project membership and shared budget enforcement in production.
- Verified that the UI-only release activated without recreating Core and retained UI 1.3.1 for rollback.
- Removed all temporary acceptance users and resources after the checks.

## New facts

- Billing must forward the selected tenant header into its live Identity verification; Billing 1.2.2 owns this behavior.
- Project ACLs remain explicit after tenant transfer. A team member does not receive project detail access until the project owner adds that user to the project.
- A production checkout with restrictive file or directory modes can produce an image that passes a root read probe but fails after the entrypoint drops to `node`.

## Recorded in

- `docs/kb/deploy.md`

## Remaining questions

- The PostgreSQL backup passed archive listing validation, but this release did not include a restore drill.

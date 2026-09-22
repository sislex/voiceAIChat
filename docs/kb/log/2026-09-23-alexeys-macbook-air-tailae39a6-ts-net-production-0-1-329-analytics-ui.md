---
title: production-0-1-329-analytics-ui
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# production-0-1-329-analytics-ui

## What changed

- Released Core 0.1.329 with the managed Analytics service and authenticated account-report proxy.
- Corrected Analytics-to-Billing API compatibility and released Analytics 1.2.2.
- Released Core UI 1.3.1 and activated its immutable browser artifact without restarting Core.
- Verified the account analytics page in production with a temporary user and removed that user afterward.

## New verified facts

- Billing application 1.2.0 exposes the reporting contract as API 1.1.0.
- A render-time default timestamp caused the account report request loop; Analytics 1.2.2 fixes it by retaining one boundary per mounted view.
- The independent browser release can be activated and rolled back without changing the Core container.

## Knowledge base updates

- `docs/kb/deploy.md`

## Remaining work

- Implement shared team tenants, invitations, budgets, and tenant-owned resources.

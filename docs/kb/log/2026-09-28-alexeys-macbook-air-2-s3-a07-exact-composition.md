---
title: s3-a07-exact-composition
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# S3 A07 exact composition

## Changed

- Pinned reviewed Identity, Billing and Analytics owner archives that reconcile
  delegated application charges with the stable account subject and token totals.
- Recovered the worker's synthetic SDK/Core/Runner acceptance harness and Core
  queue and message persistence changes. The supported Claude text-only loopback
  scenario passed locally before the final Core gate.

## Established facts

- The earlier Identity archive returned the login for delegated Billing admission;
  the current owner archive returns the stable account subject UUID.
- The earlier Billing report contained only application event and cost totals;
  Analytics 1.3.0 requires token and missing-usage totals from Billing main.
- The pinned Runner rejects Codex `textOnly` before child startup. Claude has a
  supported no-tools invocation, which the A07 harness exercises. Codex is a
  separate capability gap, never an implicit tool-enabled fallback.

## Knowledge topic

- `docs/kb/data-auth.md`, Core delegated chat adapter.

## Remaining work

- Run the full Core gate on the final commit, review and merge A07, then record
  owner acceptance. Production deployment and feature enablement are separate.
- Implement and review a safe Codex no-tools path before claiming provider parity.

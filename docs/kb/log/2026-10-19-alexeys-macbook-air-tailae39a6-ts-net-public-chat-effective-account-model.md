---
title: public-chat-effective-account-model
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-effective-account-model

## Changes

- Project the effective account provider and selected model in GET and PUT
  `/api/settings` responses when a deployment model policy is configured.
- Keep stored preferences, unrelated settings, inactive model selection and the
  explicit engine preference intact. A subsequent unrelated patch does not
  persist the policy fallback.

## Evidence and findings

- Required quick gate `npm run gate:quick -- --base
  dfbff91864a835461a39dd87743f136f72306eb3` passed with exit code 0: server and
  knowledge typecheck/build, 50 related test files / 437 tests and the final
  changed-file rerun of 11 tests. Independent production-diff review was clean.
- Eleven focused HTTP and turn-manager tests passed: fresh defaults, PUT
  projection, live user revocations, no model access, explicit engine transport
  resolution and independent conversation overrides.
- An allowed account Sol and forbidden conversation Astra yield conversation
  Luna under the public policy. The existing context-snapshot summary provides
  this exact conversation selection; an account fallback would be incorrect.
- An engine preference affects transport selection by role and provider, not
  the deployment model fallback. Legacy deployments keep their prior response.

## Knowledge base

- `docs/kb/deploy.md`

## Acceptance boundary

- The tests use real Core routing and turn selection with synthetic model
  transports. No stand, ledger, real paid request or production data changed.

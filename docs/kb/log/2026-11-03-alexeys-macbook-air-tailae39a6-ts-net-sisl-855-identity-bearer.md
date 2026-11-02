---
title: sisl-855-identity-bearer
date: 2026-11-03
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# sisl-855-identity-bearer

## Changes

- Route explicit OAuth-mode Bearer requests through the existing embedded or remote Identity verifier. Standalone Admin forwards bearer verification to Core.
- Add real Identity RPC and Core integration regressions for API tokens, board proxy admission, revocation, blocked accounts, tenant and read-only restrictions. Retain cookie CSRF and OAuth exchange coverage.

## Findings

- Passing API-session tokens to auth-client's OAuth JWT verifier bypassed Identity API-session authentication and caused 401 responses.

## Knowledge

- docs/kb/data-auth.md#identity-oauth-mode

## Operations

- Production commissioning and supervisor gates remain outside this patch; no deployment or credentials were changed.

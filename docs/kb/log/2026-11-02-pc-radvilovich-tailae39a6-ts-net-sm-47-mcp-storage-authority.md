---
title: sm-47-mcp-storage-authority
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# sm-47-mcp-storage-authority

## Changes

Core Storage now admits verified owner MCP authority with the corresponding Make service credential. Browser cookies cannot be mixed into it; task-source scopes cannot become user-wide Storage access. The paired Make change supplies request-local signed authority after MCP admission.

## Verified knowledge

Storage previously accepted ticket delegations but did not consume the MCP token used by internal shared-service RPCs. Covered legacy/shared read and write admission plus forged, expired and foreign credentials in applicationTickets.delegation.test.ts.

## Documentation

- docs/kb/data-auth.md

## Validation

- Core `npm run gate:fast`: passed typecheck/build; 2557 server tests and 19 knowledge tests passed, 57 server tests skipped by existing conditions.
- Make `npm run gate:fast`: passed typechecks and 239 tests.
- Both repositories: `npm run kb:check` and `git diff --check` exited 0. Core KB reports five pre-existing stale topics unrelated to this change.

## Delivery

Ship with the paired Make SM-47 change. No production deployment was performed.

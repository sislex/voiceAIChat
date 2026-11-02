---
title: oauth-probe-fixture-clock
date: 2026-11-02
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# oauth-probe-fixture-clock

## Changes

- Fixed OAuth fixture expiration and added five authenticated Storage probes.
- Added a deterministic two-second clock advance before the code callback.

## Verified findings

- Before the fix, the clock advance reproduced HTTP 503 instead of 200.
- Recomputing JWT expiration changed the subject-token Map key; the stub issued
  an exchanged JWT without a subject, rejected by the pinned auth client.
- With fixed expiration, the same regression passes.

## Documentation

- docs/kb/data-auth.md, Identity OAuth mode.

## Open questions

- None.

---
title: sisl-766-runner-lifetime
date: 2026-10-28
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# sisl-766-runner-lifetime

## Changes

Recorded the verified Runner diagnostic boundary and SISL-766 owner fix in
[LLM execution](../llm.md#independent-runner-boundary). The owner checkout is
`owners/llm-runner/repository` on SISL-766 with full Git history; the fix is
committed as `261a2c5`. Core still pins released Runner 0.3.8; owner publication
and a fixed stand composition are required before end-to-end acceptance.

The output flush deadline previously started at child close, which waits for
inherited pipes. It now starts at exit, preserves tail output for two seconds
and finalizes/removes the member once. Tests include a real process whose
descendant retains stdout, accounted/unaccounted leases and HTTP member snapshots.
The existing master-only details endpoint already exposes member IDs.

## Validation

- Runner task gate: 79 tests, 11 files, exit 0; separate typecheck passed.
- Core `npm run gate:fast`: exit 0, documentation-only selection.
- Runner `gate:fast` aliases its full gate; the bounded task gate was used
  to respect the task's prohibition on development-time full gates.

## Acceptance still open

The reproduced pipe-lifetime defect is not proven to explain the historical
settlement/count mismatch. A fresh Mailpit journey with exact Runner member
snapshots is still required for registration/verification, Luna/Terra streaming,
retry, reload/history, reconnect, understandable errors and Stop.

On MacBook, Docker reports the retained stand and Mailpit containers stopped.
The historical scripts were located under
`/Users/alexeyrozhnov/.local/state/sislexa/operator/public-chat-v1`
(including `accept-default-target-stop.mjs` and `accept-lifecycle.mjs`), but
`remote:read` rejected access because only this task checkout and its owners
directory are allowed. Supply accessible acceptance inputs/configuration before
resuming the stand run. No historical journal, ledger, deployment or live email
was changed. SISL-770/domain commissioning remains out of scope.


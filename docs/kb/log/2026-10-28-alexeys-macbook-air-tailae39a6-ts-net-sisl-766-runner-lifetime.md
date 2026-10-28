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

## Stand acceptance transferred to follow-up

The reproduced pipe-lifetime defect is not proven to explain the historical
settlement/count mismatch. A fresh Mailpit journey with exact Runner member
snapshots is still required for registration/verification, Luna/Terra streaming,
retry, reload/history, reconnect, understandable errors and Stop.

On MacBook, Docker reports the retained stand and Mailpit containers stopped.
The historical scripts were located under
`/Users/alexeyrozhnov/.local/state/sislexa/operator/public-chat-v1`
(including `accept-default-target-stop.mjs` and `accept-lifecycle.mjs`), but
`remote:read` rejected access because only this task checkout and its owners
directory are allowed. Per the user's scope decision, the remaining stand work belongs to follow-up
[task b1742ac7-ca2b-4bd2-bffc-bd2d9af3b1cd](/projects/e3dea006-b6f7-45ea-8fa3-97502501456d/task/b1742ac7-ca2b-4bd2-bffc-bd2d9af3b1cd).
The repository portion of SISL-766 is complete; do not request broader access or
work around the bridge restrictions here.

Follow-up handoff:

1. Compose a test stand with the Runner fix `261a2c5` and record exact Core,
   Identity, Billing and Runner source/image identities. Core's currently pinned
   0.3.8 archive does not include this new fix.
2. Use acceptance scripts/configuration accessible within that task's authorized
   roots; preserve the historical failed journal and all accounting records.
3. Repeat Mailpit registration and verification as an ordinary user with no CLI
   login, machine or workdir setup. Exercise every allowed model, including
   Luna/Terra, and verify streamed answers, retry and history after reload.
4. Exercise reconnect, understandable provider errors and Stop with background
   completion/settlement. Check no duplicate execution or charge, no late stopped
   output, and successful subsequent admission.
5. Capture master-only `/v1/admin/lifecycle?details=true` at the final assertion
   and correlate member IDs/phases with receipts and settlement. Do not replace
   the failing assertion with a blind delay or claim that the reproduced pipe
   defect explains the historical count without that evidence.

This commit records the handoff; it does not claim to have edited the remote
card, for which this session has no write tool. No historical journal, ledger,
deployment or live email was changed. SISL-770/domain commissioning remains
out of scope.


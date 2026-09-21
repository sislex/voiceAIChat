# Chat execution accounting

Status: implementation in progress. Production baseline is Core 0.1.317.

## Acceptance boundary

Every chat model invocation must have stable user and tenant attribution, a durable
operation ID, authoritative Billing admission and recoverable usage evidence.
Existing unlimited accounts keep access. Request/concurrency limits apply before
spawn. A finite monetary policy must reject an executor without a proven spending
bound; post-response cancellation is not a prepaid guarantee. Current Codex/Claude
CLI execution is treated as unbounded until an independently verified bounded
adapter is available. A zero-cost reservation must not disguise unbounded work.

## Ownership and sequence

1. SDK/Billing add explicit unbounded admission, rejecting finite monetary policies
   and finite-policy changes while unbounded work remains active or uncertain.
   Persist immutable model/token/pricing evidence with settlement, preserving
   idempotency and legacy bounded reservations.
2. The independent runner persists a receipt before spawn, rejects duplicate
   execution across restart, and records numeric usage independently of socket
   delivery. Receipts are scoped to the authenticated calling application.
   Request bodies, prompts, provider credentials and MCP tokens are never stored
   in the receipt ledger; only a fingerprint binds the execution request.
3. Core constructs attribution from the verified session and conversation, never
   from a WebSocket body. Preserve the existing login-based CLI profile key.
   Queue entries retain their initiating session reference, not bearer credentials;
   a missing or revoked delegation pauses execution instead of changing payers.
4. Core writes an operation/outbox before contacting the executor. Completion,
   cancellation and transport failure reconcile against the durable runner
   receipt. Unknown execution or incomplete provider usage keeps the reservation
   uncertain. Only proven unstarted work is released without a charge.
5. Exercise a real HTTP Chat -> Billing -> runner path with fake provider processes,
   covering isolation, concurrent requests, retries, restart and partial failure.
   Run canonical gates, publish immutable releases, deploy and verify production.

## Reporting rules

Provider-reported cost and a catalog estimate remain distinguishable. Unknown
models or missing usage are not silently priced at zero. Token counters are
disjoint; cumulative Codex thread snapshots need an authoritative baseline before
being converted into one invocation's consumption. Raw usage evidence survives
settlement retries and remains available for the later Analytics projection.

This increment does not introduce payment collection or silently enable paid API
accounts. Make/image generation outside the chat turn manager and background
workflows need their own verified delegation integrations before their milestone
can be marked complete.

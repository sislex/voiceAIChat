---
title: billing-runtime-foundation
date: 2026-09-20
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# billing-runtime-foundation

## Changes

Published SDK 1.0.0, Identity 1.2.0 and Billing 1.0.0 with independent PRs, CI gates
and immutable provenance. Core pins the releases, delegates upstream checks and
adds managed Billing account/policy proxies, deployment configuration and catalog
entries. Identity owns the new stable subject mapping and PostgreSQL FK actions.
Image Studio 1.0.5 supplies the standalone browser entry and bounds API shutdown
with unfinished HTTP requests, fixing the remote restart integration gate.
The release preparation retains prior images and provider registries for rollback;
rollback keeps additive stable identities and the durable Billing ledger.

## Validation

Independent gates cover SQLite concurrent admission, replay/settlement and live
Identity authority, plus a real Billing standalone process. Identity's full gate
includes PostgreSQL. Core PostgreSQL schema/bootstrap/copy tests passed (9 tests).
A complete production backup was restored in an isolated PostgreSQL database;
Identity stable-ID initialization preserved users, sessions, tenants and tariff
rows byte-for-byte and retained IDs on repeated startup. Core `gate:fast` passed.
The first pre-PR `gate` run failed with widespread timeout errors while macOS
repeatedly slept (confirmed by the power log); it is not release evidence. A
complete canonical rerun passed with exit code zero: 2,387 Core tests and all
807 browser tests passed, along with workspace typechecks, tests and builds.
A fresh 2026-09-21 10:35 UTC production backup passed the same full restore and
identity migration checks. No implementation code changed between the green gates.

## Knowledge

Updated data-auth.md, deploy.md and the delivery roadmap. Billing requires stable
IDs, keeps uncertain execution reserved, and records actual overspend. Executing
providers must enforce work bounds; publishing a ledger does not enforce model
budgets by itself. Production remains on 0.1.316 until separately verified.

Follow-up runner audit confirmed that accounting context and enforceable monetary
allocations are not yet part of its request/CLI adapters. Preserve the existing
CLI profile key when introducing stable accounting IDs. The Codex reference's
experimental rollout tracking is not evidence of strict prepaid enforcement;
this limit is documented in the Billing section with its primary source.

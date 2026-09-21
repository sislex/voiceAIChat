---
title: users-page-startup
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Users page startup

Core 0.1.320 fixed the Identity activity-map 500 and passed 57 production component
checks. Both reported user-list URLs returned 200 in three concurrent rounds
(37–96 ms inside the server, 86–169 ms in browser samples). Browser startup still
took 19–20 seconds. Its waterfall and new API diagnostics showed simultaneous
delays in usage-summary, users, settings, conversations and other initial reads.

PostgreSQL activity identified the summary's repeated text-to-JSONB aggregates.
Core serializes repository methods even on PostgreSQL, so the summary held up
other domains. Thirty-five paired health probes stayed below 200 ms for Core and
Identity, excluding an event-loop stall. An unbounded diagnostic summary exceeded
its client timeout; its temporary account was blocked/revoked and subsequently
removed. No production data or schema was changed by the diagnostic queries.

The monthly candidate uses a materialized JSONB CTE and one model aggregate,
then sums the model rows for per-user totals. A read-only production query took
1,197 ms for 17 model groups. A repeatable-read daily comparison matched the old
model rows and user totals: 65 ms for the candidate versus 200 + 175 ms for the
two old queries. An all-history candidate hit the explicit five-second diagnostic
statement timeout; large-range reporting is still a separate optimization.

SQLite and isolated local PostgreSQL regressions cover inclusive dates, multiple models, zero-usage accounts,
missing users, interruption flags, incomplete prices and database price estimates.
Documented in `data-auth.md`, `server-internals.md` and `deploy.md`.

Both canonical gates passed 2,402 server tests, typecheck and server build.
Remaining: next release and production startup acceptance;
then continue `docs/plans/extraction-completion.md`.

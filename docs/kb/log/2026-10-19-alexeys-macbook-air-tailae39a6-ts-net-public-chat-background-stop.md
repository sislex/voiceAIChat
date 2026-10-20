---
title: public-chat-background-stop
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# public-chat-background-stop

## Changes

- Added an explicit server-configured policy for ordinary public Chat Stop. A
  dispatched executor continues without DELETE or abort; Core stops forwarding
  output and reconciles final usage exactly once.
- Graceful shutdown waits for background executions before closing the outbox.
- Public queues remain paused after Stop. Early resume/send-now and new requests
  check pending accounting by stable user identity before consuming queued work.

## Evidence

- Required quick gate `npm run gate:quick -- --base
  0e050cbcdc0ecffa1c2fc8263f50f10b6f10cd42` passed with exit code 0: server and
  knowledge typecheck/build, 55 related test files / 568 tests, followed by the
  changed-file rerun of 2 files / 129 tests.
- Focused HTTP Billing/Runner and turn-manager regression suites: 21 accounting
  tests and 108 turn-manager tests passed.
- HTTP cases cover no-spawn zero, delayed completion, blocked second admission,
  default/delegated/internal hard cancellation, missing-usage holds and shutdown.
- Turn-manager regression verifies retained queued messages, one interrupted
  partial answer, no late overwrite and explicit resume after settlement.
- Deterministic admission races cover another conversation reserving the user
  after queue extraction or a send-now merge, and a concurrent Billing rejection.
  The extracted payload returns to the front as queued, with its original order.
- Independent read-only review identified the queue extraction races above;
  their fixes received a clean follow-up review.

## Knowledge base

- `docs/kb/data-auth.md`
- `docs/kb/server-internals.md`

## Acceptance boundary

- Real stand acceptance is separate from these synthetic tests. Existing uncertain
  operations were not altered; no production or stand processes were changed.

---
title: ws-bootstrap-delivery
date: 2026-09-21
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# WebSocket bootstrap delivery

## Change

Production Chat accounting acceptance exposed an older incoming-frame gap between
authentication and asynchronous session initialization. Install incoming/close
listeners first, queue authentication frames before setup frames, and release the
queue only after initialization. Failure drops queued commands; early close runs
cleanup after setup. Adjacent regression tests cover all three boundaries.

## Validation

The five focused WebSocket tests passed. Canonical `gate:fast` and `gate` passed the complete Core suite: 2398 tests
passed, with 42 expected skips. Transport patch deployment is pending at this checkpoint. Core 0.1.318 accounting
is already deployed and accepted with real initial/resumed Codex turns.

## Knowledge

Updated `docs/kb/server-internals.md` with the initialization ordering invariant.
Updated `docs/kb/deploy.md` with 0.1.318 image, backup, deployment recovery and real
usage evidence, and advanced the accounting plan without marking the wider
cross-tool milestones complete.

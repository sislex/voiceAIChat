---
title: gate-all-audit
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# gate-all-audit

## Findings

Inspected Core e96c10c3 without running another expensive full gate. Owner unit
suites are outside Core workspaces. The full fallback repeats the frontend
artifact E2E suite, whereas direct gate:all does not include the full catalog
browser union. Desktop dependencies are reinstalled unconditionally. Route
measurement has 100 seconds of explicit waits plus compression and browser work.
No current total duration was measured and no runtime/gate behavior was changed.

## Documentation

Updated docs/kb/testing-operations.md with the current command chain, ownership,
scheduling overlap and optimization candidates. Kept the user's main checkout
clean by recording the audit in a separate worktree.

## Follow-up

Deduplicate the fallback schedule, add validated dependency/compression caches,
and retain Core integration coverage. Validate performance with stage timings
before claiming a speedup.

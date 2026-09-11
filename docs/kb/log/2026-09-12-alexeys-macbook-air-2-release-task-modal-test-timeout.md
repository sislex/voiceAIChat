---
title: release-task-modal-test-timeout
date: 2026-09-12
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# Release TaskModal test timeout

## Work completed

- Increased the shared Testing Library asynchronous query timeout from five to
  ten seconds for DOM suites.
- Re-ran all three responsive task-creation dialog cases on the release branch.

## Newly confirmed facts

- Release `0.1.299` exhausted the five-second allowance while loading the first
  lazy TaskModal chunk under regression load.
- The failing scenario and the complete `App.dom.test.tsx` file both pass in
  isolation, matching a machine-load timing failure rather than a UI regression.

## Knowledge base updates

- `docs/kb/testing-operations.md`, Testing Library lazy-chunk guidance.

## Open questions

- None.

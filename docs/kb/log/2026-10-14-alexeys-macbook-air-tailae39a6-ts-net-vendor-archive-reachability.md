---
title: vendor-archive-reachability
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# vendor-archive-reachability

## Changes

Added shared vendor archive reachability and post-pin cleanup, with isolated reference, replacement and failure regressions; removed 47 unused archives totaling 125372643 bytes while retaining the 29 referenced archives and unchanged lockfile/inventories.

## Verified findings

Release publication consumes `asset` from `vendor/ui-libraries.json` as well as owner/snapshot inventories; `filename` is publication metadata. Core has three archive pin paths: shared-chat handoff, contracts release and release composition.

## Existing topics updated

- `testing-operations`: archive retention rule.
- `features/task-preparation`: current preparation ownership and stale historical paths.

## Remaining owner work

Prompt/parser implementation and its strict-format normalization tests are absent from this Core checkout and belong to `sislexa-kanban`; they cannot be verified or changed here. Core readiness gate regressions remain in `packages/shared/src/qa.test.ts`.

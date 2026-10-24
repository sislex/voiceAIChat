---
title: multi-repo-merge-recovery
date: 2026-10-24
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# multi-repo-merge-recovery

## Changes

Documented URL-keyed permanent owner merge clones, aggregate preparation before
publication, terminal owner failures and the explicit reconcile API.

## Verified findings

Kanban owns the merge implementation. The previous owner pipeline reused task
checkouts and could publish before peer checks completed. Reconcile now checks
source ancestry in each origin target and moves the card to done only when all
parts are contained.

## Knowledge destination

- docs/kb/features/merge-runner.md

## Validation

Real-origin regression tests cover isolation, foreign origins, failed preparation,
partial publication and successful/partial reconciliation. Task gates validate
the changed server and Core documentation scope.

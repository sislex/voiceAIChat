---
title: merge-target-persistence
date: 2026-10-15
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# merge-target-persistence

## Changes

Persist and return the project base as each merge run's immutable target.
Widen MergeRun.targetBranch to string. Normalize empty workspace bases to main
and create component ticket branches from origin/<base>.

## Verified facts

Core and the standalone Kanban repository both contain CiRepo persistence.
Execution belongs to sislexa-kanban; both merge UI surfaces belong to
sislexa-core-ui. Core alone cannot deliver the whole behavior.

TC-1/TC-2/TC-5 exercise database storage, reads, lists and active-run reuse.
TC-3 checks component tickets and real Git conversation preflight.

## Updated topics

- docs/kb/projects.md
- docs/kb/features/merge-runner.md

## Delivery

The three SISL-736 owner changes belong together. No deployment, project setting
change, dev-to-main promotion or push is part of this task.

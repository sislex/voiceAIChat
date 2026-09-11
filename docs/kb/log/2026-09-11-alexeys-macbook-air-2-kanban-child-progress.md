---
title: kanban-child-progress
date: 2026-09-11
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-child-progress

## Changes

- Extended direct-child progress from backlog cards to every workflow stage.
- Added semantic values, percentage, completed/total, remaining, zero, and
  complete states with compact and mobile layout rules.

## Verified findings

- Epics and stories use the same direct-child calculation, so both hierarchy
  levels explain their progress without a separate data source.

## Knowledge base

- `docs/kb/projects.md`, section “Child task progress”.

## Open questions

- None.

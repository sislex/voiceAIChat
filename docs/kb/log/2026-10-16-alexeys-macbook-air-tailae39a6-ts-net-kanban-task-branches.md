---
title: kanban-task-branches
date: 2026-10-16
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# kanban-task-branches

## Changes

- Documented Kanban task branches: start from `origin/<ciBaseBranch>` and merge
  into the same project base branch; Sislexa projects use `dev`.
- Documented `dev` to `main` promotion or pull request as a separate step.
- Updated the topic metadata and regenerated the KB index.

## Evidence

- Existing guidance: `docs/kb/projects.md#merge-target-persistence`.
- Created `SISL-737` from `origin/dev` at `ec1cc3a3974636ce742cd9cda4bff4fbec2e8285`.

## Updated topic

- docs/kb/conventions.md

## Remaining workflow

- The runner publishes the task branch; the merge run must target `dev`.

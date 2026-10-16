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

## Automated QA follow-up

- Automated QA reported an `@fastify/static` startup timeout in
  `apps/server/src/session.test.ts` (one failed test).
- Reran `npm run test:files -- apps/server/src/session.test.ts`: all 31 tests
  passed, exit code 0. The reported test passed in 1112 ms; the file took 45.86 s.
- The timeout did not reproduce in this targeted run. This does not establish
  its root cause or replace the subsequent automated QA stage.
- Retained the documentation-only scope; no runtime or test code was changed.

## Remaining workflow

- The runner publishes the task branch; the merge run must target `dev`.

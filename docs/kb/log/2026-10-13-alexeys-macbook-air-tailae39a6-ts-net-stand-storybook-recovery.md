---
title: stand-storybook-recovery
date: 2026-10-13
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# stand-storybook-recovery

## Changes

- Persist Storybook intents through Core settings and recover them once per process
  when the agent is online. Explicit Stop removes the intent.
- Cover surviving-port adoption, relaunch, offline agents, failure retention,
  concurrent refresh, and the stand open route after session reconstruction.

## Findings

- Persist the original command without generated port/CI arguments so recovery
  does not append those arguments twice.

## Documentation

- docs/kb/deploy.md, Managed stands.

## Validation

- Direct Vitest execution: 38 tests passed in the two changed test files and
  `routes/projectComponents.test.ts`.
- Direct TypeScript execution: server typecheck passed.
- Required task gate needs the supervisor: npm invocation exits 255; direct
  `node --import tsx scripts/task-gate.mjs --base 7abd408552502ab64cecce737325eee7fc2fc14d`
  fails with `spawnSync git EPERM`.
- KB log and index generators were run directly. The generated index was restored
  because unavailable Git subprocesses incorrectly changed unrelated topic status.

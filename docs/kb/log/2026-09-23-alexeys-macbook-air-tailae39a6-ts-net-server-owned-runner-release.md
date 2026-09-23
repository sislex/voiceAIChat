---
title: server-owned-runner-release
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# server-owned-runner-release

## Completed

- Removed the LLM Runner GitHub Actions workflow and registry dependency in owner PR #15.
- Released and deployed LLM Runner 0.3.5 through the dedicated host pipeline.
- Verified immutable image pinning, rollback, container security, health, and public Core access.

## New facts

- A tagged runner release can be fully gated, built, and smoke-tested on the dedicated host without GitHub Actions or GHCR.
- Production Compose accepts the immutable local Docker image ID as `RUNNER_IMAGE`.
- The first operator-script failure restored 0.3.4 before the corrected 0.3.5 deployment.

## Recorded in

- `docs/kb/deploy.md`

## Remaining work

- None for this migration.

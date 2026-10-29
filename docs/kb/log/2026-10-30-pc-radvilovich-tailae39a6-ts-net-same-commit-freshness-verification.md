---
title: same-commit-freshness-verification
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# same-commit-freshness-verification

## Verification

- Resumed the implementation preserved in WIP commit 68d5e9a4.
- All 10 kb-tools tests passed, including the three freshness scenarios in both default and custom KB directories.
- `npm run typecheck:kb-tools`, `npm run gate:fast` and `git diff --check` passed. The fast gate selected no applications because implementation changes were already committed; the package tests and typecheck were run explicitly.
- Reconciled the older freshness description in kb-workflow with the implemented per-topic commit exclusion.
- Reviewed the kb-tools delta tracked by features/project-knowledge-base: it changes CLI staleness only, preserving indexing, visibility and host adapters; refreshed that topic's checkpoint.

## Documentation

- docs/kb/kb-workflow.md
- packages/kb-tools/README.md (operator publication and consumer pins)

## Existing repository issues

Global `kb check --strict` reports five unrelated topics invalidated by the preceding release-pin commit 2b107639: features/ci-runner, features/releases, stt-runner, testing-operations and tts-runner. Their checkpoints were not changed without reviewing their implementations. Release publication and consumer pin updates remain operator-owned.

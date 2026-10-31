---
title: same-commit-topic-freshness
date: 2026-10-30
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# same-commit-topic-freshness

## Changes

- Exclude area commits that also modify the checked topic from SHA-based staleness.
- Cover combined code/topic commits, later code-only commits and touch-only commits
  in default and configured KB directories, including paths containing spaces.
- All 10 package tests and the package/adapter typechecks passed.

## Verified behavior

- `touch` records the current HEAD before committing. Comparing full commit IDs
  against the topic history prevents the combined commit from invalidating itself.
- Updating another topic does not exempt a later area change.
- Consumer installations require an operator release and pin/lockfile updates.

## Documentation

- docs/kb/kb-workflow.md
- packages/kb-tools/README.md

## Remaining work

- Release publication and consumer pin updates are outside this task.

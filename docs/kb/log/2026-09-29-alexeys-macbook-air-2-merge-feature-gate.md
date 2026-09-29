---
title: merge-feature-gate
date: 2026-09-29
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# merge-feature-gate

## Что сделано

- Added an optional merge-only project command and a focused Core merge gate.
- Verified the CHAT-495 diff in an isolated worktree: the focused gate passed in 36 seconds after dependency installation.

## Что выяснили (факты, которых не было в KB)

- The project-wide test command was `npm run gate:release`; it ran the system matrix during every merge and failed when the merge machine could not fetch an unrelated private repository.
- The CHAT-495 diff contains changed owner regression files and two known tooling changes, allowing a bounded selection without changing release verification.

## Куда занесено

- docs/kb/features/merge-runner.md

## Открытые вопросы / что осталось

- The merge-only command must be configured for the production ChatAI project after this Core change is released. Existing projects retain their prior command until then.

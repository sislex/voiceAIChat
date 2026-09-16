---
title: temporary-resource-lifecycle
date: 2026-09-16
machine: pc-radvilovich
author: voiceAIChat agent
---

# Temporary resource lifecycle and strict Development Brief

Registered application-owned process directories, merge worktrees and task environments;
added persistent consumer exclusion, retry/retention, descriptor-safe deletion, Git
publication protection, artifact archives, read-only preview and an attempt journal.
Added marked regression coverage TC-01–TC-11. Removed age-only cache cleanup and
unverified terminal-status/force cleanup. Development Brief parsing now validates
the entire response and rejects prose/fences instead of silently stripping them.

The old TaskRepository display record did not prove inode ownership or consumers;
legacy resources therefore remain visible but retained. MergePanel already refreshes
repository state on events and reconnect. These facts and lifecycle settings are in
`features/ci-runner.md` and `features/merge-runner.md`; strict response rules and
normalization regressions are in the existing `features/task-preparation.md`.

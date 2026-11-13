---
title: conversation-branch-reuse
date: 2026-10-30
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# conversation-branch-reuse

## Changes

- Local stand preparation reuses an existing local or origin default conversation branch, preserving local history; an absent branch starts from dev.
- Attachment reports the absolute path of an occupied worktree without starting live mode.
- Added workspace cases for new/local/remote branches and occupied worktrees, plus adapter coverage for the component payload and error propagation. Both test files passed (114 tests). `npm run gate:fast` passed: Core typecheck/build, 2406 Core tests and 19 knowledge tests (40 Core tests skipped).

## Verified findings

- Component attach sends only defaultBranch and local=true. Previously prepare treated that default as a mandatory new branch and returned branch_exists.
- Core previously mapped detailed workspace errors to operation_conflict; it now preserves branch_checked_out path diagnostics.

## Documentation

- docs/kb/server-internals.md#make-conversation-stand-worktrees

## Remaining acceptance

- UI port 23002 responds, but its stand API returns HTTP 401 without an authenticated session. Live attach/reload/detach acceptance has not been verified.

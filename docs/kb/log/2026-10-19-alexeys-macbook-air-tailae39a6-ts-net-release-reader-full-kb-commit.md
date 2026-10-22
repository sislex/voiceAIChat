---
title: release-reader-full-kb-commit
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Reader publication and release knowledge metadata

Playwright Reader 1.2.6 is published at 386b14a004ceb4cac02023984e841897b85ed26c. Core now pins that verified commit in the tools lock and both API/browser image references.

The shared KB touch command abbreviates HEAD, but Web Reader requires a full 40-character checked commit. Owner preparation now preserves that strict contract by writing the complete reviewed version-bump commit after touch, before indexing and the separate reconciliation commit. Topic content is unchanged.

The release adapter regression exercises a real Git fixture through preparation and verifies full metadata, its reachable parent commit and a clean worktree. The 29 release-runner tests passed. Details are recorded in docs/kb/deploy.md.

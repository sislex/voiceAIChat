---
title: Release checkout upstream
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Release checkout upstream

## Completed

- Configured the production release branch upstream during the protected checkout switch.
- Corrected the direct Browser UI install procedure to use an extracted artifact directory.

## Learned

- `git checkout -B` does not attach a newly created local release branch to its remote branch.
- The detached `voicechat-deploy` starts with `git pull --ff-only`, so an absent upstream stops safely before any build.

## Recorded in

- `docs/kb/deploy.md`

## Remaining work

- None.

---
title: kanban-owner-image
date: 2026-09-30
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# kanban-owner-image

## Changes

- Core Compose now consumes a commit-tagged image produced by `sislex/sislexa-kanban` instead of building the Kanban runtime from the Core checkout.
- The Core Dockerfile no longer contains a Kanban runtime stage. The profile remains opt-in, and embedded mode remains the default.

## Findings

- The owner repository builds and starts its image with PostgreSQL in a disposable container. Images are published manually after its gate passes; GitHub Actions is disabled for this repository.
- The available GitHub token cannot publish to GHCR (`packages:write` is unavailable), so Core references a locally loaded, commit-tagged Linux image.
- Production still runs `VC_KANBAN_MODE=embedded`; switching modes requires a verified image, matching Core consumer integration, and a controlled single-writer cutover.

## Knowledge base

- `docs/kb/deploy.md` and `docs/docker.md`.

## Remaining work

- Verify the published image and current Core consumer integration before enabling the production Kanban profile.
- Move the browser UI and replace bootstrap shared dependency snapshots with pinned owner artifacts.

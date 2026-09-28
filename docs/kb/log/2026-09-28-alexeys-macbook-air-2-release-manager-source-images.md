---
title: release-manager-source-images
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# release-manager-source-images

## Changes

- Bound the standard release-manager deploy command to the selected checkout and exact SHA.
- Added a local image pin generator and a guarded production wrapper for Core-only releases.
- Added tests for source binding and missing owner images.

## Findings

- Production `VC_REPO_DIR` pointed to immutable Core 0.1.334 while the release manager switched a different checkout to 0.1.335. The button launched the old commit with the new version label.
- The persistent Compose chain referenced private GHCR images although the verified owner images were still available locally. Pulling Billing failed with `unauthorized`.

## Knowledge base

- docs/kb/deploy.md

## Remaining work

- Merge and release this change before using the standard button for another Core release. Keep the production environment pointed at the release-manager checkout for direct operator invocations.

---
title: independent-browser-ui
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Independent browser UI releases

Core can select an owner-built immutable browser artifact from persistent data
without rebuilding or restarting its process. The shared manifest contract owns
version ranges, provenance and asset identity. Validation rejects corrupt,
unlisted, missing or linked files and incompatible API/host requirements.

The live compatibility endpoint distinguishes the effective UI generation from
the configured generation, allowing recovery to the bundled UI after a Core
upgrade rejects an older browser artifact. HTML is never cached; versioned assets
remain immutable and available to old tabs. The production launcher shares the
Core deployment lock and installs files as the server user.

Targeted contract, static-server, CLI and real Chromium switching tests passed.
Chromium verified a lazy import and an unchanged draft in an old tab after
activation, new-tab version selection, rollback, concurrent HTML responses and
retained API authentication. The full Core gate passed in 267.10 seconds.
Web/Electron route budgets passed in 178.28 seconds and all 67 installed-owner
system scenarios passed against this exact Core commit. Core 0.1.327 deployed
through the installed server command; component readiness, provider authorization,
consumer RPCs and panel assets passed production checks. UI 1.1.1 is active;
install/rollback/reactivation preserved Core container identity and start time.
Old-tab lazy imports and drafts, new-tab selection, Users/Account and product
panels passed real Chromium acceptance. The owner fixed a macOS AppleDouble
packaging failure caught by Core before activation; its complete release gate
and GitHub CI passed. Detailed evidence is recorded in the deployment article.

Documentation: `docs/kb/ui.md`, `docs/kb/deploy.md`,
`docs/kb/features/releases.md`, and `docs/plans/independent-browser-ui-releases.md`.

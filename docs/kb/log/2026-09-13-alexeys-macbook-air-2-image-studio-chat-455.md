---
title: image-studio-chat-455
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# image-studio-chat-455

## Changes

Extended the existing Image Studio gallery, viewer, canvas tools, history,
publication flow, server routes, and web/desktop ports for CHAT-455. Added row
windowing from 200 files, keyboard/modifier selection, server ZIP downloads,
persistent tags and date filters, 50-prompt history with per-prompt settings,
server-owned generation tasks, draft publication previews and watermarks, and
a mobile bottom composer. Canvas crop rectangles are bounded to image pixels
while preserving their preset ratio; successful uploads update the gallery
before selecting the new version.

## Verified findings

The former gallery mixed pagination with windowing and used the pane scroll
offset without subtracting the grid position. A stale offset could produce an
empty window. The former crop stage included text outside the image, allowing a
fixed-ratio selection to extend beyond the raster and change ratio when saved.
REST generation and the new task API now use the same execution function and
active-run slot. Existing source/operation metadata is retained for canvas
versions and tag edits.

Browser tests exercise real canvas output and gallery layouts at 721, 720, and
390 pixels, with screenshots in the local ignored .generated_images directory.
Automated checks carry TC01–TC09 markers across DOM, API, and browser tests.

## Validation

`npm run gate:app -- image-studio` passed (54 server tests and 20 bridge contract
checks). `npm run gate:app -- image-studio-ui` passed (338 package tests, four
host checks, and 13 browser checks). `npm run test:storybook` passed; generated
story IDs were checked against the built index. The 390px composer and gallery
screenshots were visually inspected. The expanded fast gate exposed a wall-clock
timeout in the legacy run-restoration DOM test; that test now advances the real
polling interval with fake timers and verifies both API polls explicitly.

The final `npm run gate:fast` run passed with exit code 0, launched through
`gate:fast:logged` (run 20260912231121155-b54f6e4c-3ec3-4e37-b8c0-11fef5f68b7c).
The existing selector expanded the changed E2E path to repository-wide checks;
all workspace checks/builds and 783 browser tests across 28 files passed.

## Documentation

- docs/kb/ui.md
- docs/kb/server-internals.md

## Workflow boundary

No production deployment or push. The structured Component QA workflow consumes
the development commit in the following stage; this log does not claim that
post-development workflow run has passed.

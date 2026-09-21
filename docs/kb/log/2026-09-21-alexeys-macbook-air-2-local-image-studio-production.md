---
title: local-image-studio-production
date: 2026-09-21
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# local-image-studio-production

## Changes

Configured a separate local Image Studio API on 18896 with an SSH tunnel to
production Core on 18787. Issued a private seven-day provider token with the three
Image Studio dependency scopes; existing production credentials and the local
8796 process were preserved. Private launch/config/data files live outside Git.

## Validation

Readiness returned 200 with Core ready. Anonymous access returned 401; a temporary
production user's session reached the expected inaccessible-conversation 404;
a foreign tenant hint returned 403. No generation request was submitted.

## Knowledge

Updated deploy.md and Image Studio's operations guide. API root 404 is expected;
the user later requested the standalone studio UI. The full Core-shell proxy was
replaced with the owned `apps/studio-web` entry in the Image Studio repository.
The UI on 18897 includes gallery selection/creation and the existing image panel,
with production Identity sign-in and local image operations. Browser checks
confirmed login, local upload/read, logout and no overflow at 390 px. The full
Image Studio gate passed, including the new HTTP boundary and DOM tests.
The production user credential is still required in addition to the provider grant.

Image Studio PRs #3 and #4 merged after green GitHub gates. Release 1.0.5
(`08e00d6524c1a21d405ad98340d618cb3d6f92b6`) contains the bounded-shutdown
fix and the standalone browser entry. The local UI serves the tested standalone
build; production remains on the prior deployment pending the Core release gate.

After laptop sleep, the local API remained live while SSH had exited. Added a
private supervised tunnel loop and verified automatic reconnection by terminating
its SSH child, then checking restored Core readiness. The launcher now selects
the 1.0.5 checkout; no production credential or application process was replaced.

The post-sleep browser regression passed again: production sign-in, gallery
creation, upload, full-size viewer, logout, 390px layout and zero page errors.

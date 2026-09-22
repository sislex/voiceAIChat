---
title: agent-desktop-owners
date: 2026-09-22
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Agent and Desktop ownership

## Completed owner work

Agent PRs #1/#2 merged to `eabeddd09a291dc44277222a2bd606a62743e516`.
Runtime 0.20.0 and contracts 1.0.0 own companion, installer and device client tests.
Owner typecheck/test/build gates passed locally and in GitHub. Packaged runtime
handshake/exec and VPN guard checks passed. Both macOS ARM64 DMGs built, and the
login application's packaged protocol smoke passed.

Desktop PRs #1/#2/#3 merged to `46cf9854ef8f98801e94af87d8396bc313158bcc`.
Desktop 1.0.2 consumes Agent 0.20.0 and Core chat-client 1.0.1, the latter built
from clean Core `e96c10c3`. Typechecks, 23 tests, builds and actual Electron
setup-to-login/preload isolation checks passed locally and in GitHub CI.
The obsolete first-origin embedded-backend restart was removed.

## Core changes

Removed four application source directories and moved machine protocol/installer
implementation and unit tests to the Agent owner. Core preserves contract reexports
for already published consumer compatibility, and public host/server integration.
Core now serves the prebuilt Agent script and consumes the Desktop renderer artifact.
The independent chat renderer publisher remains Core-owned with the shared chat UI.

## Acceptance still in progress

Core full gates, production rollout and post-deployment test optimization are
tracked in docs/plans/agent-desktop-extraction.md. This log does not claim those
steps passed before their actual completion.

The renderer preserves the original Electron chrome126 target and disabled module-preload polyfill. All 96 existing route budget metrics passed without changing thresholds.

Core typechecks and workspace tests passed, including 2299 server and 3168 UI cases.
The native Electron telemetry probe passed. The first full browser run exposed a
Reader input fixture race; locator-relative input fixes it, with all 29 Reader
cases passing without successful-step screenshots. The final full rerun passed.

The complete Core gate:fast passed, including all 126 catalog browser cases.
Before release, Desktop native networking QA found the historical file-origin
login limitation. Desktop 1.0.2 uses sislexa://app; Core explicitly allows that
origin. Owner gates passed locally and in GitHub, including real login transport,
HttpOnly cookies and denial of unrelated CORS origins. All 22 Core auth cases
passed with the new origin. The final Core gate included this artifact and passed in 731.5 seconds
(run 20260922073558604-adc997d7-cf08-4670-bdd9-d2b29a1abfa6):
all workspace checks/builds, 16 frontend route cases, all 96 budget metrics and
126 catalog browser cases. Production acceptance and gate optimization follow merge.

---
title: chat460-run-feed
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# chat460-run-feed

## Changes

Implemented run-feed filtering/search and line navigation, interaction drafts
and plan diffs, selected-step retry previews, project queue visibility, stage
usage, console history/completion/confirmation, slot command previews and
machine checks, and mobile layout. Added stories and behavior tests.

## Verified findings

Transport chunks are not physical log lines. TaskRunFeed and DevelopmentRunFeed
previously omitted the interaction event subscription. Retry resumes in the
same run/workspace using current slots, and command IDs can repeat in a slot.
Queue scheduling follows project board order and uses a server-wide slot limit;
model interactions release their slot.

## Documentation

- docs/kb/features/ci-runner.md, Contract and UI section.

## Validation

Targeted RunFeed and TaskRunFeed DOM tests pass, including the feed axe check.
Chromium at 390×844 has no horizontal page overflow; the sticky action row is
56px high and the console occupies the full viewport. Browser axe reports no
violations for the feed or open console. Server cancellation/queue tests pass.
`npm run gate:fast` completed with exit code 0 on 2026-09-13 (logged run
`20260913073136842-a9a25453-9b04-449f-96d0-364fe07e31dd`). The checkout needed
separate `npm ci` installs for desktop, agent-tray and login-application; no
tracked dependency files changed.

---
title: Public chat candidate UI composition
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Public chat candidate UI composition

## Changes

The Core UI candidate combines daily quota display, configured-module voice
onboarding, chat readiness without voice, and a readable mobile model picker.
Core consumes the canonical owner artifact through the release-composition
mechanism; the owner implementation stays outside this repository.

## Findings

Disabled voice onboarding intentionally leaves saved onboarding progress intact.

The composition also includes the first-chat model fix: effective Core settings
and conversation snapshots supply the allowed selection, and an explicit draft
selection is saved before sending. Failed saves and navigation preserve the
draft without starting a stale request. Owner regression coverage and canonical
pack evidence are recorded in the launch plan.
Shell readiness therefore cannot depend on that progress being complete when
no voice setup is available. A mobile model picker also needs a visible trigger,
a readable text column and placement relative to the composer rather than the
narrow trigger button. Both regressions have owner tests.

The release-composition helper replaces archive hashes and commit IDs but
preserves historical compatibility metadata. Copy the candidate requirements
from the verified archive provenance as well: this renderer requires Shared
0.1.42, not the old pin metadata's 0.1.16.

## Knowledge

- docs/kb/clients.md
- docs/plans/public-chat-v1.md

## Remaining work

Review and official publication, managed environment application, and public
DNS/TLS, mail and separate service-account commissioning remain distinct from
candidate source gates and local stand acceptance.

---
title: delivery-control-031-worker-trial
date: 2026-09-25
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# delivery-control-031-worker-trial

## Changes

Recorded the independent coordinator and sole enrolled worker upgrade to 0.3.1,
including exact source/archive identity, backup, restricted tunnel and LaunchAgents.
Preserved the distinction between B01–B05 acceptance, incomplete B06 continuation,
and future product stages. The original Core working checkout was not changed.

## Verified findings

The first real queued B06 attempt exposed memory admission, environment handoff,
source scanning and blocked-result retention defects. Main a2963b6 fixes these;
owner gates on macOS/Linux, fresh PostgreSQL integration and a deterministic
blocked-worker rehearsal passed. The reviewed partial B06 base d96d193 passed
33 owner tests and four PostgreSQL scenarios; it is a continuation, not acceptance.

## Knowledge updated

- docs/kb/deploy.md — coordinator foundation and one-worker commissioning state.

## Remaining work

B06 concrete adapters and automatic QA/defect/stage workflow, then S0 acceptance
and S1–S4. Read the coordinator API for current status; snapshots in docs do not
assign tasks or authorize stage advancement.

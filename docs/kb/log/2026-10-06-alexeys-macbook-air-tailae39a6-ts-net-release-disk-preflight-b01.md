---
title: release-disk-preflight-b01
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# release-disk-preflight-b01

## Changes

- Added the release disk threshold, strict preflight parser, HTTP 409 error body,
  request override flags, REST path and Russian cleanup prompt with focused tests.

## Findings

- Unmeasurable machines fail closed and require an error message. Aggregate
  success must agree with every machine check.

## Documentation

- docs/kb/protocol.md

## Follow-up

- Kanban C01 and Core UI C02 implement the consumers; the integrator builds the
  shared archive without a B01 version bump.
- Sandbox denies child-process Git access. KB index generation was attempted
  but its output incorrectly cleared unrelated freshness warnings, so the
  existing generated index was preserved for regeneration by the supervisor.

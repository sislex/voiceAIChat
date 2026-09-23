---
title: gate-all-readonly-artifacts
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Read-only full-gate visual artifacts

## Work completed

- Made successful settings/onboarding screenshots opt-in through
  `VC_VISUAL_ARTIFACTS`.
- Preserved failure-only capture through `VC_VISUAL_FAILURE_ARTIFACTS`.
- Verified both the default read-only run and the explicit artifact run.

## New facts

- A routine `gate:all` run used to overwrite reviewed PNG files under
  `artifacts/onboarding/`, leaving a clean checkout dirty even when every stage
  passed.

## Knowledge base

- `docs/kb/testing-operations.md`

## Open items

- None.

---
title: qa-panels-selective-retry
date: 2026-09-13
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# qa-panels-selective-retry

## Changes

QA panels now provide combined filters, artifact previews, integration groups,
ordered step durations, source-snapshot selective retry, revision-aware manual
autosave and paste attachments, a single reviewable rework draft, metadata,
freshness and Markdown reports. Chromium checks cover all four panels at 390px;
DOM tests cover interaction and axe, and server tests cover retry validation.

## Verified findings

The previous preparation parser accepted two prose prefixes and escaped JSON
fences despite the intended strict contract. These exceptions are removed.
Compatible field normalization still runs after whole-response JSON parsing.
File navigation uses a hash route, with the selected file in the URL query.

## Updated documents

- docs/kb/features/qa-stage-runs.md
- docs/kb/features/manual-qa.md
- docs/kb/features/task-preparation.md

## Validation

`npm run gate:fast` completed with exit code 0. The UI suite passed all 3,060
tests, including axe checks and five Chromium cases at 390px. Server tests
passed (2,202 tests), including selective retry and preparation regressions.
Standalone desktop app dependencies were restored using their existing
lockfiles; no dependency manifests or lockfiles changed.

## Manual verification limits

Synthetic paste is tested. Interaction with a real system clipboard and human
documentation review remain TC-10 and TC-14 manual acceptance steps.

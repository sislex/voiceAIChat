---
title: environments-b01-review
date: 2026-10-02
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# environments-b01-review

## Changes

- Added the Shared environment contracts and strict parsers.
- Added Core environment storage with project membership checks, immutable
  configuration revisions, and one active operation per environment.
- Added repository tests for SQLite and PostgreSQL, including concurrent
  PostgreSQL connections.

## Findings

- A clean Core install must retain the workspace Shared version while existing
  owner artifacts require its exact peer baseline. The independently versioned
  Shared 0.1.14 archive is built from the committed source in a follow-up pin.
- The macOS native worker sandbox cannot launch Chromium for the Core browser
  suite. The protected operator gate ran that suite against the exact source.

## Knowledge base

- `docs/kb/data-auth.md` documents the environment storage boundary.

## Validation

- `npm ci` and the complete Core gate passed in an isolated checkout.
- The environment repository suite passed on disposable PostgreSQL.

---
title: b01-bounded-cold-start
date: 2026-10-08
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# b01-bounded-cold-start

## Changes

- Added bounded cold-start history, optional summary placement and last-message tail retention.
- Turn execution and context inspection share the environment-configured budget.
- Added shared boundary tests, inspector parity and lost Codex thread regression coverage.

## Findings

- The history budget includes rendered roles and separators; notices, summaries and other context are additional.

## Documentation

- docs/kb/server-internals.md: Bounded cold-start conversation history.

## Validation limitations

- Required task gate needs supervisor execution: sandbox denies child git with EPERM.
- KB index generation cannot inspect git in this sandbox; generated index changes were discarded to avoid falsely clearing freshness warnings.

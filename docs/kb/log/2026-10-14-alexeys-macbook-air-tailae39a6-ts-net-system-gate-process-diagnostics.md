---
title: system-gate-process-diagnostics
date: 2026-10-14
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# system-gate-process-diagnostics

## Changes

- Process inspection now scans past unknown rows to identify active Git; unknown state still forbids cleanup.

## Findings

- Previously an unknown row could mask a later active Git row in the diagnostic.

## Documentation

- docs/kb/testing-operations.md

## Validation limits

- Parser regressions pass. The sandbox denies Git subprocesses, so the supervisor must rerun the integration tests.

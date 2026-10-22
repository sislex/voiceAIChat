---
title: release-gate-speed-b01
date: 2026-10-06
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# release-gate-speed-b01

## Changes

- Added verified full-gate base selection, per-owner system selection, performance selection and the promotion attestation helper.

## Findings

- Full Core fallback must preserve independent owner selection. Pin comparison cannot rely on the application's narrowed-plan metadata.

## Documentation

- docs/kb/testing-operations.md, release regression section.

## Verification and commissioning

- Focused release/system/attestation tests pass. Task planning is blocked by sandbox `spawnSync git EPERM`; direct TypeScript checking reports existing errors in imported files, with no diagnostics in changed scripts.
- The promotion operator must call the attestation helper after a successful full gate for the captured SHA. No tags were created or pushed during implementation.
- KB commands were invoked; sandbox Git restrictions prevent reliable freshness metadata generation. The supervisor should regenerate the index.

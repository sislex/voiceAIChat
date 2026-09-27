---
title: s3-a07-owner-artifacts
date: 2026-09-28
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s3-a07-owner-artifacts

## Changes

- Pinned the accepted A05 SDK archive from `f6313db5ff58cc35fa8dacc90b9844f9706dcfba` and A06 Analytics archive from `f398196a38438cc818d9d5c6db375c205dd0dea3`.
- Updated Core package references, owner inventory, consumer lock and Analytics deployment source lock while retaining the accepted S3 Identity, Billing and Runner sources.
- Recovered the A07 preflight and registry tests from the first worker attempt in an isolated checkout.

## Findings

- A07's first attempt lacked assigned SDK and Analytics artifacts. The model boundary could not fetch them from GitHub. The operator verified their archive digests and installed bytes outside that boundary.
- `node scripts/a07-composition.mjs` now verifies the six exact owner packages. Its success is an artifact check, not end-to-end acceptance.

## Knowledge base

- `docs/kb/data-auth.md`, Core delegated chat adapter.

## Remaining work

- Prove synthetic paid execution, revocation, queue recovery and Analytics/Billing reconciliation before accepting A07.
- Keep external delegated chat disabled in production until A07 and S3 commissioning are complete.

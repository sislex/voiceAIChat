---
title: s2-local-release
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s2-local-release

## Completed

- Documented local image build, direct SSH transfer, exact image verification,
  and deployment through the existing locked release command.

## Findings

- A locally loaded image is release preparation; it does not prove that the
  production container was replaced or that browser UI was activated.

## Recorded in

- docs/kb/deploy.md

## Remaining work

- Verify the final Core release gate, transfer each pinned image, and record
  production readiness and rollback evidence after deployment.

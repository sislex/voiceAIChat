---
title: s4-application-report-provider-pins
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s4-application-report-provider-pins

## Changes

- Prepared immutable Billing and Analytics owner archives for the S4 application report, and pinned their exact commits, hashes, versions and API compatibility in Core.

## Findings

- Billing 1.2.2 API 1.2.0 adds per-application request, cost and token evidence without changing Core's existing reservation API.
- Analytics 1.3.0 API 1.2.0 requires those buckets and keeps module activity separate from registered application spend.

## Knowledge base

- docs/kb/deploy.md, managed component installation.

## Remaining work

- Merge these S4 pins only after the S3 release boundary; build and verify the complete S4 release set before production deployment.

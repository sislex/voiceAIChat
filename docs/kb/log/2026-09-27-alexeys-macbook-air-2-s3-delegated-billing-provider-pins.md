---
title: s3-delegated-billing-provider-pins
date: 2026-09-27
machine: alexeys-macbook-air-2
author: alexeyrozhnov
---

# s3-delegated-billing-provider-pins

## Changes

- Pinned clean Identity and Billing archives to the owner commits that provide delegated billing admission.
- Updated the component installation grant for Billing and the owner artifact inventory.

## Findings

- Identity validates live Core grants through an internal Billing-only scope; Billing rechecks at reserve and start.
- Core still needs to pass the original in-memory grant to that path before standalone paid turns can run.

## Documentation

- docs/kb/data-auth.md

## Outstanding

- Complete A04 Core adapter and exact-composition A07 tests before exposing external application execution.

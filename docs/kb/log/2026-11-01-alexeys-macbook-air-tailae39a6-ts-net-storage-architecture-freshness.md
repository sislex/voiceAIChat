---
title: storage-architecture-freshness
date: 2026-11-01
machine: alexeys-macbook-air-tailae39a6-ts-net
author: voicechat-ci
---

# storage-architecture-freshness

## Changes

Reviewed all changed architecture areas since 47b29314: storage changes in
15683f3a, 15f87e36 and 91891a52, including Core's thumbnail upload response.
Updated the existing File storage service section and refreshed its marker
through the configured KB CLI.

## Verified facts

Resumable sessions persist node manifests and parts and reserve capacity for
parts plus assembly; ordinary temporary-blob accounting does not describe these
reservations. The coordinator owns upload metadata, access/quota checks,
thumbnail lookup, small-content listing and batch preflight. Copy executes
on the source node without transferring file bytes through Core.

## Updated topic

- docs/kb/architecture.md

## Validation

KB check no longer reports architecture, shared or server-internals.
The remaining 21 warnings match the exemptions in the latest supplied workflow
output. git diff --check passes. No runtime code or gate command changed;
the workflow will rerun the complete step.

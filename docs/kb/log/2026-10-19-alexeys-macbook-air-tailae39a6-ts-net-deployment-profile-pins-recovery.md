---
title: Deployment profile pins and unchanged-runtime recovery
date: 2026-10-19
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# Deployment profile pins and unchanged-runtime recovery

## Changes

- Derive application profiles before pinning the release Compose service set.
- Add an explicit operator recovery command for known failures with a proven unchanged runtime.
- Cover profiled browser pins, invalid settings, recovery evidence and refused transitions in the existing tooling gate.

## Findings

- Compose configuration excludes inactive profiles. Deriving profiles only inside the detached launcher leaves owner services outside immutable image pins.
- Failed Compose completion must not be represented as successful completion. Unchanged-runtime recovery preserves the failed exit and stores a separate audit receipt outside the operation-record scan.

## Documentation

- docs/kb/deploy.md: local owner image delivery and controlled deployment operation status.

## Scope

- Fenced operations, unknown completion and any observed container transition remain blocked for other recovery procedures.

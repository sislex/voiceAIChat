---
title: core-memory-bounds
date: 2026-10-10
machine: alexeys-macbook-air-tailae39a6-ts-net
author: unknown
---

# core-memory-bounds

## Changes

- Bounded both HTTP machine exec relays with 8 MiB/1 MiB hysteresis and explicit dropped-byte notifications, preserving terminal records and cancellation.
- Added paused-socket, normal-output, remote-error and cancellation tests.
- Configured Core heap diagnostics and a stoppable, unreferenced five-minute memory logger.

## Findings

- Both exec routes share one implementation. Other raw HTTP writers are terminal MCP errors or completed LLM SSE responses; PTY events use WebSockets.

## Topics

- docs/kb/server-internals.md
- docs/kb/deploy.md

## Validation

- Direct TypeScript check passed. The memory logger test passed; loopback HTTP tests require supervisor execution because this sandbox rejects listen with EPERM.
- npm gate:task, test:files and typecheck wrappers exited 255 without diagnostics. No deployment was performed.

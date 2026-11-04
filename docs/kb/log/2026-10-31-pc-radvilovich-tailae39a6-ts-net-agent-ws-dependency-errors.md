---
title: agent-ws-dependency-errors
date: 2026-10-31
machine: pc-radvilovich-tailae39a6-ts-net
author: voiceAIChat agent
---

# agent-ws-dependency-errors

## Changes

- Contained agent message/pong/close failures and async registry change-listener rejections.
- Added strict child-process WebSocket regression tests with Identity RPC failure and recovery.
- Added update-audit failure and registry subscriber regression coverage.

## Verified findings

- EventEmitter does not await async listeners; the agent registration audit previously rejected outside any catch.
- Close cleanup must precede the asynchronous last-seen write.
- The generic WebSocket message queue, Identity session verification and account sweep already catch dependency failures.

## Updated topic

- docs/kb/conventions.md#async-порты-бд-ловушки-которых-компилятор-не-видит

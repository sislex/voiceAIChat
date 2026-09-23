---
title: chat-to-make-replay
date: 2026-09-23
machine: alexeys-macbook-air-tailae39a6-ts-net
author: alexeyrozhnov
---

# chat-to-make-replay

## What changed

- Clarified the Chat-to-Make replay contract after verifying turn-manager behavior.

## New facts

- A repeated `claude.send` is queue-idempotent while a turn is active, but a
  consumer must suppress redispatch after an AI response already exists.
- A replay containing only the stored user message remains the recovery path for
  a lost draft-creation response before the turn was sent.

## Recorded in

- `docs/kb/protocol.md`

## Remaining work

- None for the Core transport contract.

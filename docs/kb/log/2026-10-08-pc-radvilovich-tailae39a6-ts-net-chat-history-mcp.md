---
title: chat-history-mcp
date: 2026-10-08
machine: pc-radvilovich-tailae39a6-ts-net
author: unknown
---

# chat-history-mcp

## Что сделано

- Added a conversation-scoped, read-only history MCP server and wired its per-turn token lifecycle into Core turns.
- Added full-text search, bounded neighbour reads, truncation, the context toggle, long-chat discovery hint, and focused tests.

## Что выяснили (факты, которых не было в KB)

- History tools must receive their scope from a server-issued turn token; accepting a conversation id from tool input would permit cross-chat reads.

## Куда занесено

- docs/kb/server-internals.md

## Открытые вопросы / что осталось

- Focused runtime tests and the task gate must run in the supervisor environment because the sandbox terminates the Vitest child process with exit 255.
